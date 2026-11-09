import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Page } from 'playwright';
import { StatusBar } from '../components/StatusBar';
import { startRecording, stopRecording, saveScenario, type ScenarioStep } from '../engine/scenario';
import type { Config } from '../types';

interface Props {
  page: Page;
  config: Config;
  onBack: () => void;
  onActivity: (message: string) => void;
}

export function ScenarioRecorder({ page, config, onBack, onActivity }: Props) {
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [steps, setSteps] = useState<ScenarioStep[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  useInput((input, key) => {
    if (saved) {
      // Recording is done and written to disk — nothing left to do here,
      // so any key takes you back rather than leaving a dead-end screen.
      onBack();
      return;
    }
    // Esc must work even while still typing the name — otherwise picking
    // "Record a scenario" by mistake leaves you with no way back until you
    // commit to a name and start recording.
    if (key.escape) {
      onBack();
      return;
    }
    if (!named) return;
    if (input === 's') {
      stopRecording(page).then(() => {
        const savedPath = saveScenario(name, steps, config);
        setSaved(savedPath);
        onActivity(`Saved scenario "${name}" — ${steps.length} step(s)`);
      });
    }
  });

  if (!named) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column" padding={1}>
          <Text bold>Record a scenario</Text>
          <Box marginTop={1}>
            <Text>Name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={async value => {
                if (!value.trim()) return;
                setNamed(true);
                await startRecording(page, step => setSteps(prev => [...prev, step]));
                onActivity(`Started recording scenario "${value.trim()}"`);
              }}
            />
          </Box>
        </Box>
        <StatusBar text="Type a name and press Enter" spinning={false} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} padding={1}>
        <Text bold>Recording "{name}" — interact in the browser now</Text>
        <Box marginTop={1} flexDirection="column">
          {steps.slice(-15).map((s, i) => (
            <Text key={i} dimColor>
              {s.action} {s.selector.type}={s.selector.value}
            </Text>
          ))}
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{saved ? 'Press any key to continue' : 's save & stop · Esc cancel'}</Text>
      </Box>
      <StatusBar
        text={saved ? `Saved to ${saved}` : `Recording… ${steps.length} step(s) captured`}
        spinning={!saved}
        tone={saved ? 'success' : 'info'}
      />
    </Box>
  );
}
