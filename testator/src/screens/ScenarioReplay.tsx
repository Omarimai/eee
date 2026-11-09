import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Page } from 'playwright';
import { StatusBar } from '../components/StatusBar';
import { Menu } from '../components/Menu';
import { listScenarios, loadScenario, replayStep } from '../engine/scenario';
import type { Config } from '../types';

interface Props {
  page: Page;
  config: Config;
  onBack: () => void;
  onActivity: (message: string) => void;
}

export function ScenarioReplay({ page, config, onBack, onActivity }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading scenarios…');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const list = listScenarios(config);
    setNames(list);
    setStatus(list.length ? 'Pick a scenario' : 'No scenarios saved yet — press Esc to go back');
  }, []);

  useEffect(() => {
    if (!chosen) return;
    (async () => {
      const scenario = loadScenario(chosen, config);
      onActivity(`Replaying scenario "${chosen}" — ${scenario.steps.length} step(s)`);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        setStatus(`Replaying step ${i + 1}/${scenario.steps.length}: ${step.action} ${step.selector.value}`);
        await replayStep(page, step);
      }
      setStatus(`Done — replayed ${scenario.steps.length} step(s)`);
      setDone(true);
      onActivity(`Finished replaying "${chosen}"`);
    })().catch(err => {
      setStatus(`Error: ${err.message}`);
      onActivity(`Replay of "${chosen}" failed: ${err.message}`);
    });
  }, [chosen]);

  // The Menu (and its own Esc handler) only exists before a scenario is
  // picked — it unmounts the moment replay starts, which left this screen
  // with zero keyboard handling while running, when done, and even in the
  // empty-scenarios state despite its own status text promising "press Esc".
  useInput((_input, key) => {
    if (done) {
      onBack();
      return;
    }
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} padding={1}>
        <Text bold>Replay a scenario</Text>
        {!chosen && names.length > 0 && (
          <Box marginTop={1}>
            <Menu items={names.map(n => ({ label: n, value: n }))} onSelect={setChosen} onCancel={onBack} />
          </Box>
        )}
        {done && (
          <Box marginTop={1}>
            <Text dimColor>Press any key to continue</Text>
          </Box>
        )}
      </Box>
      <StatusBar text={status} spinning={!done && !!chosen} tone={done ? 'success' : 'info'} />
    </Box>
  );
}
