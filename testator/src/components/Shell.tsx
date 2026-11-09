import React from 'react';
import { Box } from 'ink';
import { Fullscreen } from './Fullscreen';
import { HeaderBar } from './HeaderBar';

/**
 * The app's one top-level layout: `Fullscreen` for the alternate-screen
 * buffer, `HeaderBar` pinned above, and whatever `app.tsx` is currently
 * routing to filling the rest. Every screen in the app renders inside this.
 */
interface Props {
  environment: string;
  authUser: string | null;
  browserStatus: 'connecting' | 'ready' | 'error';
  lastActivity: string | null;
  children: React.ReactNode;
}

export function Shell({ environment, authUser, browserStatus, lastActivity, children }: Props) {
  return (
    <Fullscreen>
      <HeaderBar environment={environment} authUser={authUser} browserStatus={browserStatus} lastActivity={lastActivity} />
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Fullscreen>
  );
}
