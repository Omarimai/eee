import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface Props {
  text: string;
  spinning?: boolean;
  tone?: 'info' | 'success' | 'error';
}

export function StatusBar({ text, spinning = true, tone = 'info' }: Props) {
  const color = tone === 'success' ? 'green' : tone === 'error' ? 'red' : 'cyan';
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      {spinning ? (
        <Text color={color}>
          <Spinner type="dots" />
        </Text>
      ) : (
        <Text color={color}>{tone === 'success' ? '✓' : tone === 'error' ? '✗' : '•'}</Text>
      )}
      <Text> {text}</Text>
    </Box>
  );
}
