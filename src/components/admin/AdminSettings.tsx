"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Box, Button, Callout, Card, Flex, SegmentedControl, Spinner, Switch, Text, TextField } from "@radix-ui/themes";
import { formatTimeAgo } from "@/lib/format";
import { MODE_LABEL, isUploadMode } from "@/modules/playground/mode";
import type { Settings, SettingsPatch } from "@/modules/settings";
import {
  ADMIN_PASSCODE_HEADER,
  ADMIN_SETTINGS_ENDPOINT,
  type AdminErrorBody,
  type AdminSettingsBody,
  type AdminSettingsUpdate,
} from "@/modules/settings/api";

const PASSCODE_STORAGE_KEY = "elite-ledger:admin-passcode";
const NAME_STORAGE_KEY = "elite-ledger:admin-name";
const MAX_NAME_LENGTH = 80;

function readStored(storage: "session" | "local", key: string): string {
  try {
    return (storage === "session" ? window.sessionStorage : window.localStorage).getItem(key) ?? "";
  } catch {
    return ""; // storage blocked: the field simply shows again next time
  }
}

function store(storage: "session" | "local", key: string, value: string | null): void {
  try {
    const target = storage === "session" ? window.sessionStorage : window.localStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    // ignore
  }
}

/** What one answer of the admin endpoint means for the page. */
type Outcome =
  | { type: "ok"; body: AdminSettingsBody }
  | { type: "locked" }
  | { type: "disabled" }
  | { type: "error"; message: string };

async function call(passcode: string, update?: AdminSettingsUpdate): Promise<Outcome> {
  const headers: Record<string, string> = {};
  // Header values must be printable ASCII; anything else cannot be the passcode.
  if (passcode !== "" && /^[\x20-\x7e]+$/.test(passcode)) headers[ADMIN_PASSCODE_HEADER] = passcode;
  if (update) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(ADMIN_SETTINGS_ENDPOINT, {
      method: update ? "PUT" : "GET",
      headers,
      body: update ? JSON.stringify(update) : undefined,
      cache: "no-store",
    });
  } catch {
    return { type: "error", message: "Could not reach the server. Check your connection and try again." };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: the host answered instead of the app.
  }
  if (response.ok && body && typeof body === "object" && "settings" in body) {
    return { type: "ok", body: body as AdminSettingsBody };
  }
  if (response.status === 401) return { type: "locked" };
  if (response.status === 503) return { type: "disabled" };
  const message = (body as AdminErrorBody | null)?.error?.message;
  return { type: "error", message: message ?? `The server answered with HTTP ${response.status}.` };
}

type Phase = "loading" | "locked" | "disabled" | "ready" | "failed";
type SaveState = "idle" | "saving" | "saved" | "error";

export function AdminSettings() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [passcode, setPasscode] = useState("");
  const [passcodeRejected, setPasscodeRejected] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [saved, setSaved] = useState<AdminSettingsBody | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  /** The clock the "last changed" line reads; null until something was loaded. */
  const [now, setNow] = useState<number | null>(null);

  function accept(body: AdminSettingsBody) {
    setSaved(body);
    setDraft(body.settings);
    setNow(Date.now());
    setPhase("ready");
  }

  /** What the answer to "give me the settings" (asked with `code`) means: decides which face of the page shows. */
  function settle(outcome: Outcome, code: string, fromForm: boolean): boolean {
    if (outcome.type === "ok") {
      if (code !== "") store("session", PASSCODE_STORAGE_KEY, code);
      setPasscodeRejected(false);
      accept(outcome.body);
      return true;
    }
    if (outcome.type === "locked") {
      store("session", PASSCODE_STORAGE_KEY, null);
      setPasscodeRejected(fromForm);
      setPhase("locked");
    } else if (outcome.type === "disabled") {
      setPhase("disabled");
    } else if (fromForm) {
      // Too many tries, or the server is down: say so under the field and stay on it.
      setLoadError(outcome.message);
      setPhase("locked");
    } else {
      setLoadError(outcome.message);
      setPhase("failed");
    }
    return false;
  }

  async function load(code: string, fromForm: boolean): Promise<void> {
    settle(await call(code), code, fromForm);
  }

  const onFirstAnswer = useEffectEvent((outcome: Outcome, stored: string, storedName: string) => {
    const unlocked = settle(outcome, stored, false);
    setPasscode(unlocked ? stored : "");
    setName(storedName);
  });

  // First visit of this tab: try the remembered passcode (or none, which is enough locally).
  useEffect(() => {
    let live = true;
    const stored = readStored("session", PASSCODE_STORAGE_KEY);
    const storedName = readStored("local", NAME_STORAGE_KEY);
    void call(stored).then((outcome) => {
      if (live) onFirstAnswer(outcome, stored, storedName);
    });
    return () => {
      live = false;
    };
  }, []);

  // Keep "3 minutes ago" honest while the page stays open.
  useEffect(() => {
    if (phase !== "ready") return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [phase]);

  // "Saved" fades back to the plain button after a moment.
  useEffect(() => {
    if (saveState !== "saved") return;
    const id = window.setTimeout(() => setSaveState("idle"), 2500);
    return () => window.clearTimeout(id);
  }, [saveState]);

  if (phase === "loading") {
    return (
      <Flex align="center" gap="2" role="status">
        <Spinner size="2" />
        <Text size="2" color="gray">
          Loading settings…
        </Text>
      </Flex>
    );
  }

  if (phase === "disabled") {
    return (
      <Callout.Root color="red" role="alert">
        <Callout.Text weight="medium">Admin is switched off on this deployment.</Callout.Text>
        <Callout.Text size="2">
          The server has no <code>ADMIN_PASSCODE</code> set. Add it to the environment variables and redeploy.
        </Callout.Text>
      </Callout.Root>
    );
  }

  if (phase === "failed") {
    return (
      <Flex direction="column" gap="3" align="start">
        <Callout.Root color="red" role="alert">
          <Callout.Text>{loadError}</Callout.Text>
        </Callout.Root>
        <Button
          variant="soft"
          onClick={() => {
            setPhase("loading");
            void load(passcode.trim(), false);
          }}
        >
          Try again
        </Button>
      </Flex>
    );
  }

  if (phase === "locked") {
    return (
      <Card size="2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const code = passcode.trim();
            if (code === "" || unlocking) return;
            setUnlocking(true);
            setLoadError("");
            void load(code, true).finally(() => setUnlocking(false));
          }}
        >
          <Flex direction="column" gap="2">
            <Text as="label" size="2" weight="medium" htmlFor="admin-passcode">
              Admin passcode
            </Text>
            <Flex gap="2" align="center" wrap="wrap">
              <Box flexGrow="1" minWidth="160px" maxWidth="320px">
                <TextField.Root
                  id="admin-passcode"
                  type="password"
                  autoComplete="off"
                  autoFocus
                  value={passcode}
                  color={passcodeRejected ? "red" : undefined}
                  aria-invalid={passcodeRejected || undefined}
                  aria-describedby="admin-passcode-help"
                  onChange={(event) => setPasscode(event.target.value)}
                />
              </Box>
              <Button type="submit" disabled={passcode.trim() === "" || unlocking}>
                {unlocking && <Spinner size="1" />}
                Unlock
              </Button>
            </Flex>
            {passcodeRejected && (
              <Text size="2" color="red" role="alert">
                Wrong passcode.
              </Text>
            )}
            {loadError && (
              <Text size="2" color="red" role="alert">
                {loadError}
              </Text>
            )}
            <Text id="admin-passcode-help" size="1" color="gray">
              Not the playground passcode. It is remembered until you close this tab.
            </Text>
          </Flex>
        </form>
      </Card>
    );
  }

  if (!saved || !draft) return null;

  const patch: SettingsPatch = {};
  if (draft.aiExtractionEnabled !== saved.settings.aiExtractionEnabled) {
    patch.aiExtractionEnabled = draft.aiExtractionEnabled;
  }
  if (draft.defaultUploadMode !== saved.settings.defaultUploadMode) {
    patch.defaultUploadMode = draft.defaultUploadMode;
  }
  const dirty = Object.keys(patch).length > 0;
  const trimmedName = name.trim();
  const saving = saveState === "saving";

  async function save() {
    if (!dirty || trimmedName === "" || saving) return;
    setSaveState("saving");
    setSaveError("");
    store("local", NAME_STORAGE_KEY, trimmedName);
    const outcome = await call(passcode.trim(), { patch, updatedBy: trimmedName });
    if (outcome.type === "ok") {
      accept(outcome.body);
      setSaveState("saved");
    } else if (outcome.type === "locked") {
      // The passcode changed under this tab: ask again.
      store("session", PASSCODE_STORAGE_KEY, null);
      setSaveState("idle");
      setPasscodeRejected(true);
      setPhase("locked");
    } else {
      setSaveState("error");
      setSaveError(outcome.type === "disabled" ? "Admin is switched off on this deployment." : outcome.message);
    }
  }

  const { lastChange } = saved;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Flex direction="column" gap="4">
        <Card size="2">
          <Flex direction="column" gap="5">
            <Flex align="start" justify="between" gap="4">
              <Flex direction="column" gap="1" minWidth="0">
                <Text as="label" size="3" weight="medium" htmlFor="setting-ai">
                  AI reading of screenshots
                </Text>
                <Text id="setting-ai-help" size="2" color="gray">
                  When off, members add rows by hand and no API credits are spent.
                </Text>
              </Flex>
              <Switch
                id="setting-ai"
                size="3"
                aria-describedby="setting-ai-help"
                checked={draft.aiExtractionEnabled}
                onCheckedChange={(checked) => {
                  setDraft({ ...draft, aiExtractionEnabled: checked });
                  setSaveState("idle");
                }}
              />
            </Flex>

            <Flex direction="column" gap="2">
              <Flex direction="column" gap="1">
                <Text size="3" weight="medium" id="setting-mode-label">
                  Default mode
                </Text>
                <Text size="2" color="gray">
                  {draft.aiExtractionEnabled
                    ? "What a member starts in until they pick a mode themselves (their choice is remembered per browser)."
                    : "Applies again once AI reading is back on. While it is off, Manual is the only mode."}
                </Text>
              </Flex>
              <Box maxWidth="320px">
                <SegmentedControl.Root
                  size="2"
                  aria-labelledby="setting-mode-label"
                  value={draft.defaultUploadMode}
                  onValueChange={(value) => {
                    if (!isUploadMode(value)) return;
                    setDraft({ ...draft, defaultUploadMode: value });
                    setSaveState("idle");
                  }}
                >
                  <SegmentedControl.Item value="manual">{MODE_LABEL.manual}</SegmentedControl.Item>
                  <SegmentedControl.Item value="ai">{MODE_LABEL.ai}</SegmentedControl.Item>
                </SegmentedControl.Root>
              </Box>
            </Flex>
          </Flex>
        </Card>

        <Card size="2">
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="setting-name">
                Your name
              </Text>
              <Box maxWidth="320px">
                <TextField.Root
                  id="setting-name"
                  required
                  autoComplete="off"
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Shown next to the change"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Box>
            </Flex>
            <Flex align="center" gap="3" wrap="wrap">
              <Button
                type="submit"
                disabled={!dirty || trimmedName === "" || saving}
                color={saveState === "saved" ? "green" : undefined}
              >
                {saving && <Spinner size="1" />}
                {saving ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}
              </Button>
              <Text size="2" color="gray" aria-live="polite">
                {saveState === "saved"
                  ? "The upload screen picks it up within a few seconds."
                  : dirty && trimmedName === ""
                    ? "Enter your name to save."
                    : dirty
                      ? "Unsaved changes."
                      : ""}
              </Text>
            </Flex>
            {saveState === "error" && (
              <Callout.Root color="red" size="1" role="alert">
                <Callout.Text>{saveError}</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
        </Card>

        <Text size="2" color="gray">
          {lastChange && now !== null
            ? `Last changed ${formatTimeAgo(Date.parse(lastChange.at), now)} by ${lastChange.by ?? "someone"}.`
            : "Never changed: these are the defaults."}
        </Text>
      </Flex>
    </form>
  );
}
