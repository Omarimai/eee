import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Browser, BrowserContext, Page } from 'playwright';
import { Shell } from './components/Shell';
import { StatusBar } from './components/StatusBar';
import { Menu } from './components/Menu';
import { loadConfig } from './config';
import { logActivity } from './engine/activityLog';
import {
  launchBrowser,
  isLoggedIn,
  getCurrentUsername,
  login,
  logout,
  saveSession,
  getWorkspaces,
  getScreens,
  selectWorkspace,
  selectScreen,
} from './engine/browser';
import { ElementExplorer } from './screens/ElementExplorer';
import { ScenarioRecorder } from './screens/ScenarioRecorder';
import { ScenarioReplay } from './screens/ScenarioReplay';
import { ActivityLogView } from './screens/ActivityLogView';
import { ExplorationTreeView } from './screens/ExplorationTreeView';
import { createRoot, ensurePath, addLeaf, type TreeNode } from './engine/tree';
import type { Config, LogEntry } from './types';
import path from 'node:path';

type Route =
  | { name: 'boot' }
  | { name: 'main' }
  | { name: 'workspace' }
  | { name: 'screen'; workspace: string }
  | { name: 'explorer'; workspace: string; screen: string }
  | { name: 'record' }
  | { name: 'replay' }
  | { name: 'activitylog' }
  | { name: 'tree' };

type BrowserStatus = 'connecting' | 'ready' | 'error';

/**
 * The app's root component and router — owns the one real browser
 * page/context for the whole session, the sign-in consent flow (see
 * `waitForAuthConsent`), the activity log and exploration tree both fed by
 * `record()`, and a hand-rolled `Route` union switched over to decide which
 * screen (`ElementExplorer`, `ScenarioRecorder`, ...) renders inside
 * `Shell`. Each screen component owns its own state; this component only
 * owns what has to survive a screen change — the page, the auth/browser
 * status, and the two session-wide logs.
 */
export function App() {
  const { exit } = useApp();
  const [config] = useState<Config>(() => loadConfig());
  const [context, setContext] = useState<BrowserContext | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus>('connecting');
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [status, setStatus] = useState('Starting…');
  const [bootError, setBootError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'boot' });
  const [workspaces, setWorkspaces] = useState<{ label: string; workspace: string }[]>([]);
  const [screens, setScreens] = useState<{ label: string; route: string }[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  // Several route branches render structurally identical JSX (e.g. every
  // picker is "<Text/><Menu/>"), so React's reconciliation can mistake one
  // screen for an update of the previous one instead of a fresh mount —
  // carrying over stale local state (a Menu's cursor position, an
  // ElementExplorer's scan results) into a screen it doesn't belong to.
  // Keying the rendered body on a counter that bumps on every navigation
  // forces a clean remount every time, which is the only fully general fix.
  const [navCounter, setNavCounter] = useState(0);

  // Positioned by the current route (and, inside the Explorer, by whichever
  // group it's drilled into — it passes its own extended path explicitly
  // since this component doesn't know about that internal state). Backing
  // out and exploring something else adds a sibling branch rather than
  // replacing anything, so this ends up a map of the whole session.
  const [tree, setTree] = useState<TreeNode>(() => createRoot());
  // Submitting real credentials into the real target app is a consequential
  // action — doing it the instant no saved session exists, with no pause,
  // is exactly the kind of silent auto-action this tool avoids everywhere
  // else. `waitForAuthConsent` pauses the boot/login-flow async sequence
  // until the user explicitly answers the prompt rendered below.
  const [authDecisionNeeded, setAuthDecisionNeeded] = useState(false);
  const authConsentResolverRef = useRef<((granted: boolean) => void) | null>(null);
  const waitForAuthConsent = (): Promise<boolean> => {
    return new Promise(resolve => {
      authConsentResolverRef.current = resolve;
      setAuthDecisionNeeded(true);
    });
  };

  useInput((input, key) => {
    if (!authDecisionNeeded) return;
    if (key.return || input === 'y' || input === 'Y') {
      setAuthDecisionNeeded(false);
      authConsentResolverRef.current?.(true);
      authConsentResolverRef.current = null;
    } else if (key.escape || input === 'n' || input === 'N') {
      setAuthDecisionNeeded(false);
      authConsentResolverRef.current?.(false);
      authConsentResolverRef.current = null;
    }
  });

  const workspaceLabel = (slug: string) => workspaces.find(w => w.workspace === slug)?.label || slug;

  const currentTreePath = (): string[] => {
    if (route.name === 'workspace') return [];
    if (route.name === 'screen') return [workspaceLabel(route.workspace)];
    if (route.name === 'explorer') return [workspaceLabel(route.workspace), route.screen];
    if (route.name === 'record') return ['Record a scenario'];
    if (route.name === 'replay') return ['Replay a scenario'];
    return [];
  };

  const onNavigate = (path: string[]) => {
    setTree(prev => ensurePath(prev, path));
  };

  const record = (message: string, pathOverride?: string[]) => {
    setLog(prev => [...prev, logActivity(config, message)]);
    setTree(prev => addLeaf(prev, pathOverride ?? currentTreePath(), message));
  };

  const navigate = (next: Route) => {
    setNavCounter(c => c + 1);
    setRoute(next);
  };

  useEffect(() => {
    onNavigate(currentTreePath());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  useEffect(() => {
    let browserRef: Browser | null = null;
    let contextRef: BrowserContext | null = null;
    (async () => {
      setStatus(`Launching ${config.browser}…`);
      const { browser, context, page } = await launchBrowser(config);
      browserRef = browser;
      contextRef = context;
      setContext(context);
      setPage(page);
      setBrowserStatus('ready');
      record(`Browser ready (${config.browser}, headless=${config.headless})`);

      const sessionAlreadyValid = await isLoggedIn(page);
      if (sessionAlreadyValid) {
        // Restoring a session you already approved logging into previously
        // isn't a new consequential action — nothing new is being
        // submitted, so this one stays silent.
        const name = await getCurrentUsername(page);
        setAuthUser(name);
        record(`Restored session for ${name ?? 'unknown user'} (no login needed)`);
      } else if (config.auth) {
        setStatus('Sign-in required');
        const granted = await waitForAuthConsent();
        if (granted) {
          setStatus(`Signing in as ${config.auth.username}…`);
          await login(page, config);
          if (await isLoggedIn(page)) {
            const name = await getCurrentUsername(page);
            setAuthUser(name);
            await saveSession(context, config);
            record(`Logged in as ${name ?? config.auth.username} (session saved for next run)`);
          } else {
            record('Login attempt failed — check config.json "auth" credentials');
          }
        } else {
          record('Sign-in declined — continuing without logging in');
        }
      }

      setStatus('Reading available workspaces…');
      const ws = await getWorkspaces(page, config);
      setWorkspaces(ws);
      setStatus('Ready');
      navigate({ name: 'main' });
    })().catch(err => {
      setBrowserStatus('error');
      setBootError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      contextRef?.close().catch(() => {});
      browserRef?.close().catch(() => {});
    };
  }, []);

  const handleLogout = async () => {
    if (!page || !context) return;
    setStatus('Logging out…');
    await logout(page, config);
    setAuthUser(null);
    record('Logged out (saved session cleared)');
    if (config.auth) {
      setStatus('Sign-in required');
      const granted = await waitForAuthConsent();
      if (granted) {
        setStatus(`Signing in as ${config.auth.username}…`);
        await login(page, config);
        if (await isLoggedIn(page)) {
          const name = await getCurrentUsername(page);
          setAuthUser(name);
          await saveSession(context, config);
          record(`Logged in as ${name ?? config.auth.username} (session saved for next run)`);
        }
      } else {
        record('Sign-in declined after logout — browsing without an active session');
      }
    }
    setStatus('Ready');
  };

  const lastActivity = log.length ? log[log.length - 1].message : null;

  if (authDecisionNeeded) {
    return (
      <Shell environment={config.environment} authUser={authUser} browserStatus={browserStatus} lastActivity={lastActivity}>
        <Box flexDirection="column" flexGrow={1} padding={1}>
          <Text bold>Sign-in required</Text>
          <Text>
            testator wants to sign in as "{config.auth?.username}" using the credentials in config.json, on:
          </Text>
          <Text dimColor>{config.baseUrl}</Text>
          <Box marginTop={1}>
            <Text dimColor>
              Decline and testator won't submit anything — the target app's own login screen stays up; you can sign in
              by hand in the browser window instead if you'd rather.
            </Text>
          </Box>
        </Box>
        <StatusBar text="Enter/y sign in · Esc/n skip (browse without logging in)" spinning={false} tone="info" />
      </Shell>
    );
  }

  if (!page || !context || route.name === 'boot') {
    return (
      <Shell environment={config.environment} authUser={authUser} browserStatus={browserStatus} lastActivity={lastActivity}>
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text>testator</Text>
        </Box>
        <StatusBar text={bootError ? `Error: ${bootError}` : status} spinning={!bootError} tone={bootError ? 'error' : 'info'} />
      </Shell>
    );
  }

  let body: React.ReactNode;

  if (route.name === 'main') {
    body = (
      <>
        <Box flexDirection="column" flexGrow={1} padding={1}>
          <Text bold>testator — main menu</Text>
          <Box marginTop={1}>
            <Menu
              items={[
                { label: 'Explore a screen', value: 'explore' },
                { label: 'Record a scenario', value: 'record' },
                { label: 'Replay a scenario', value: 'replay' },
                { label: 'View activity log', value: 'activitylog' },
                { label: 'View exploration tree', value: 'tree' },
                { label: authUser ? 'Logout' : 'Login', value: 'logout' },
                { label: 'Quit', value: 'quit' },
              ]}
              onSelect={value => {
                if (value === 'explore') navigate({ name: 'workspace' });
                else if (value === 'record') navigate({ name: 'record' });
                else if (value === 'replay') navigate({ name: 'replay' });
                else if (value === 'activitylog') navigate({ name: 'activitylog' });
                else if (value === 'tree') navigate({ name: 'tree' });
                else if (value === 'logout') handleLogout();
                else if (value === 'quit') exit();
              }}
            />
          </Box>
        </Box>
        <StatusBar text={status} spinning={status !== 'Ready'} tone={status === 'Ready' ? 'success' : 'info'} />
      </>
    );
  } else if (route.name === 'workspace') {
    body = (
      <>
        <Box flexDirection="column" flexGrow={1} padding={1}>
          <Text bold>Pick a workspace</Text>
          <Box marginTop={1}>
            <Menu
              items={workspaces.map(w => ({ label: w.label, value: w.workspace }))}
              onSelect={async value => {
                try {
                  setStatus(`Opening ${value}…`);
                  await selectWorkspace(page, config.selectors.workspacePicker, value);
                  setStatus('Reading screens…');
                  const sc = await getScreens(page, config);
                  setScreens(sc);
                  setStatus('Ready');
                  navigate({ name: 'screen', workspace: value });
                } catch (err) {
                  setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              onCancel={() => navigate({ name: 'main' })}
            />
          </Box>
        </Box>
        <StatusBar text={status} spinning={status !== 'Ready'} tone={status === 'Ready' ? 'success' : 'info'} />
      </>
    );
  } else if (route.name === 'screen') {
    body = (
      <>
        <Box flexDirection="column" flexGrow={1} padding={1}>
          <Text bold>Pick a screen</Text>
          <Box marginTop={1}>
            <Menu
              items={screens.map(s => ({ label: s.label, value: s.route }))}
              onSelect={async value => {
                try {
                  setStatus(`Opening ${value}…`);
                  await selectScreen(page, config.selectors.screenPicker, value);
                  const label = screens.find(s => s.route === value)?.label || value;
                  navigate({ name: 'explorer', workspace: route.workspace, screen: label });
                } catch (err) {
                  setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              onCancel={() => navigate({ name: 'workspace' })}
            />
          </Box>
        </Box>
        <StatusBar text={status} />
      </>
    );
  } else if (route.name === 'explorer') {
    body = (
      <ElementExplorer
        page={page}
        config={config}
        workspace={route.workspace}
        workspaceLabel={workspaceLabel(route.workspace)}
        screen={route.screen}
        onBack={() => navigate({ name: 'screen', workspace: route.workspace })}
        onActivity={record}
        onNavigate={onNavigate}
      />
    );
  } else if (route.name === 'record') {
    body = <ScenarioRecorder page={page} config={config} onBack={() => navigate({ name: 'main' })} onActivity={record} />;
  } else if (route.name === 'replay') {
    body = <ScenarioReplay page={page} config={config} onBack={() => navigate({ name: 'main' })} onActivity={record} />;
  } else if (route.name === 'activitylog') {
    body = (
      <ActivityLogView
        entries={log}
        logFilePath={path.join(config.logsDir, 'activity.log')}
        onBack={() => navigate({ name: 'main' })}
      />
    );
  } else if (route.name === 'tree') {
    body = <ExplorationTreeView tree={tree} onBack={() => navigate({ name: 'main' })} />;
  }

  return (
    <Shell environment={config.environment} authUser={authUser} browserStatus={browserStatus} lastActivity={lastActivity}>
      <React.Fragment key={navCounter}>{body}</React.Fragment>
    </Shell>
  );
}
