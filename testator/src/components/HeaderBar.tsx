import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  environment: string;
  authUser: string | null;
  browserStatus: 'connecting' | 'ready' | 'error';
  lastActivity: string | null;
}

const ENV_COLOR: Record<string, string> = {
  development: 'cyan',
  dev: 'cyan',
  test: 'cyan',
  staging: 'yellow',
  production: 'red',
  release: 'red',
  prod: 'red',
};

export function HeaderBar({ environment, authUser, browserStatus, lastActivity }: Props) {
  const envColor = ENV_COLOR[environment.toLowerCase()] || 'magenta';
  const browserDot = browserStatus === 'ready' ? '●' : browserStatus === 'connecting' ? '◐' : '○';
  const browserColor = browserStatus === 'ready' ? 'green' : browserStatus === 'connecting' ? 'yellow' : 'red';

  // Neither side had a width constraint, so once the dynamic "Last:" message
  // got long the two sides collided — overflowing the border and merging
  // text with no separating space ("readyLast: ..."). The status indicators
  // on the left must never be the thing that gets squeezed; only the
  // activity message truncates when space is tight.
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Box flexShrink={0}>
        <Text color={envColor} bold>
          [{environment.toUpperCase()}]
        </Text>
        <Text> </Text>
        <Text color={authUser ? 'green' : 'gray'}>{authUser ? `● ${authUser}` : '○ not logged in'}</Text>
        <Text> </Text>
        <Text color={browserColor}>
          {browserDot} browser {browserStatus}
        </Text>
      </Box>
      <Box flexShrink={1} marginLeft={2}>
        <Text dimColor wrap="truncate-end">
          {lastActivity ? `Last: ${lastActivity}` : ''}
        </Text>
      </Box>
    </Box>
  );
}
