import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { LogEntry } from '../types';

interface Props {
  entries: LogEntry[];
  logFilePath: string;
  onBack: () => void;
}

export function ActivityLogView({ entries, logFilePath, onBack }: Props) {
  useInput((_input, key) => {
    if (key.escape || _input === 'q') onBack();
  });

  const recent = entries.slice(-30);

  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      <Text bold>Activity log — this session</Text>
      <Box marginTop={1} flexDirection="column">
        {recent.length === 0 && <Text dimColor>No activity yet.</Text>}
        {recent.map((e, i) => (
          <Text key={i} dimColor>
            [{e.timestamp.replace('T', ' ').replace('Z', '')}] {e.message}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Full history persisted to {logFilePath} · Esc/q back</Text>
      </Box>
    </Box>
  );
}
