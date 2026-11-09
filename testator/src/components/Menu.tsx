import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface MenuItem {
  label: string;
  value: string;
}

interface Props {
  items: MenuItem[];
  onSelect: (value: string) => void;
  onCancel?: () => void;
}

export function Menu({ items, onSelect, onCancel }: Props) {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    else if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1));
    else if (key.return) {
      const item = items[cursor];
      if (item) onSelect(item.value);
    } else if (key.escape && onCancel) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Text key={item.value} color={i === cursor ? 'cyan' : undefined}>
          {i === cursor ? '❯ ' : '  '}
          {item.label}
        </Text>
      ))}
    </Box>
  );
}
