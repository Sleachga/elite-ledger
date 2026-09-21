"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Box, Button, Callout, Card, Flex, Grid, Progress, Spinner, Text, TextField } from "@radix-ui/themes";
import { NavIcon } from "@/components/shell/NavIcons";
import {
  ACCEPTED_MEDIA_TYPES,
  IMAGE_FIELD,
  PASSCODE_HEADER,
  TRY_EXTRACT_ENDPOINT,
  errorText,
  validateImageFile,
  type PlaygroundErrorBody,
  type PlaygroundStatusBody,
  type PlaygroundSuccessBody,
} from "@/modules/playground";
import { TryResult } from "./TryResult";
import styles from "./TryPlayground.module.css";

const PASSCODE_STORAGE_KEY = "elite-ledger:try-passcode";

type Phase =
  | { name: "idle" }
  | { name: "reading"; startedAt: number }
  | { name: "done"; body: PlaygroundSuccessBody }
  | { name: "error"; kind: string; detail?: string };

interface Shot {
  file: File;
  url: string;
}

function readStoredPasscode(): string {
  try {
    return window.sessionStorage.getItem(PASSCODE_STORAGE_KEY) ?? "";
  } catch {
    return ""; // storage blocked: the field simply shows again next time
  }
}

function storePasscode(value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(PASSCODE_STORAGE_KEY);
    else window.sessionStorage.setItem(PASSCODE_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isSuccessBody(body: unknown): body is PlaygroundSuccessBody {
  return typeof body === "object" && body !== null && "result" in body && "durationMs" in body;
}

function isErrorBody(body: unknown): body is PlaygroundErrorBody {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const error = (body as { error: unknown }).error;
  return typeof error === "object" && error !== null && "kind" in error;
}

/** The first image file in a drop or paste, if there is one. */
function firstImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of data.files) {
    if (file.type.startsWith("image/")) return file;
  }
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

function Reading({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <Card size="2" role="status" aria-live="polite">
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between" gap="3">
          <Flex align="center" gap="2">
            <Spinner size="2" />
            <Text size="3" weight="medium">
              Reading…
            </Text>
          </Flex>
          <Text size="2" color="gray" style={{ fontVariantNumeric: "tabular-nums" }}>
            {elapsed} s
          </Text>
        </Flex>
        {/* No value = indeterminate; Radix fills it over `duration`, then holds. */}
        <Progress size="1" duration="20s" aria-label="Reading the screenshot" />
        <Text size="2" color="gray">
          Claude is reading the screenshot row by row. This usually takes 10–20 seconds.
        </Text>
      </Flex>
    </Card>
  );
}

export function TryPlayground() {
  const [status, setStatus] = useState<PlaygroundStatusBody | null>(null);
  const [passcode, setPasscode] = useState("");
  const [passcodeAccepted, setPasscodeAccepted] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [pickError, setPickError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Ask the server whether a passcode is needed; reuse one from this tab's session.
  useEffect(() => {
    const controller = new AbortController();
    fetch(TRY_EXTRACT_ENDPOINT, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json() as Promise<PlaygroundStatusBody>)
      .then((body) => {
        setStatus(body);
        const stored = readStoredPasscode();
        if (body.passcodeRequired && stored !== "") {
          setPasscode(stored);
          setPasscodeAccepted(true);
        }
      })
      .catch(() => {
        // Unknown status: the POST itself will say what is wrong.
      });
    return () => controller.abort();
  }, []);

  // Free the preview's object URL when the screenshot changes or the page unmounts.
  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const disabled = status !== null && !status.enabled;
  const needsPasscode = status?.passcodeRequired === true && !passcodeAccepted;
  const reading = phase.name === "reading";

  async function run(file: File, code: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ name: "reading", startedAt: Date.now() });

    const form = new FormData();
    form.append(IMAGE_FIELD, file, file.name || "screenshot");
    const headers: Record<string, string> = {};
    // Header values must be printable ASCII; anything else cannot be the passcode.
    if (code !== "" && /^[\x20-\x7e]+$/.test(code)) headers[PASSCODE_HEADER] = code;

    let response: Response;
    try {
      response = await fetch(TRY_EXTRACT_ENDPOINT, {
        method: "POST",
        body: form,
        headers,
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) return;
      setPhase({
        name: "error",
        kind: "unreachable",
        detail: "Could not reach the server. Check your connection and try again.",
      });
      return;
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON: the host answered instead of the app (see the 413 case below).
    }
    if (controller.signal.aborted) return;

    if (response.ok && isSuccessBody(body)) {
      if (code !== "") {
        storePasscode(code);
        setPasscodeAccepted(true);
      }
      setPhase({ name: "done", body });
      return;
    }

    if (isErrorBody(body)) {
      if (body.error.kind === "unauthorized") {
        storePasscode(null);
        setPasscodeAccepted(false);
        setStatus((current) => ({ enabled: current?.enabled ?? true, passcodeRequired: true }));
      }
      setPhase({ name: "error", kind: body.error.kind, detail: body.error.message });
      return;
    }
    if (response.status === 413) {
      setPhase({
        name: "error",
        kind: "too_large",
        detail:
          "The host rejected the upload before it reached the app. Vercel caps request bodies at about 4.5 MB; crop the screenshot or save it as JPEG.",
      });
      return;
    }
    setPhase({
      name: "error",
      kind: response.status === 504 ? "network" : "api",
      detail: `The server answered with HTTP ${response.status}.`,
    });
  }

  function choose(file: File) {
    if (reading || disabled) return;
    const problem = validateImageFile(file);
    if (problem) {
      setPickError(errorText(problem));
      return;
    }
    setPickError(null);
    setShot({ file, url: URL.createObjectURL(file) });
    if (needsPasscode && passcode.trim() === "") {
      // Wait for the passcode; "Read screenshot" starts the run.
      setPhase({ name: "idle" });
      return;
    }
    void run(file, passcode.trim());
  }

  function tryAnother() {
    abortRef.current?.abort();
    setShot(null);
    setPickError(null);
    setPhase({ name: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Win+Shift+S then Ctrl+V. Text pastes (the passcode field) are left alone.
  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const file = firstImage(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    choose(file);
  });

  useEffect(() => {
    const listener = (event: ClipboardEvent) => onPaste(event);
    window.addEventListener("paste", listener);
    return () => window.removeEventListener("paste", listener);
  }, []);

  const canSubmitPasscode = shot !== null && !reading && passcode.trim() !== "";

  const passcodeForm = needsPasscode && (
    <Card size="2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (shot && canSubmitPasscode) void run(shot.file, passcode.trim());
        }}
      >
        <Flex direction="column" gap="2">
          <Text as="label" size="2" weight="medium" htmlFor="try-passcode">
            Passcode
          </Text>
          <Flex gap="2" align="center" wrap="wrap">
            <Box flexGrow="1" minWidth="160px" maxWidth="320px">
              <TextField.Root
                id="try-passcode"
                type="password"
                autoComplete="off"
                placeholder="Ask Sandy"
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
              />
            </Box>
            {shot && (
              <Button type="submit" disabled={!canSubmitPasscode}>
                Read screenshot
              </Button>
            )}
          </Flex>
          <Text size="1" color="gray">
            Each read spends API credits, so the playground is passcode-gated. It is remembered
            until you close this tab.
          </Text>
        </Flex>
      </form>
    </Card>
  );

  return (
    <Flex direction="column" gap="4">
      {disabled && (
        <Callout.Root color="red">
          <Callout.Text>
            {errorText("disabled")} The server has no <code>TRY_PASSCODE</code> set.
          </Callout.Text>
        </Callout.Root>
      )}

      {!shot ? (
        <>
          {passcodeForm}
          <label
            className={styles.dropzone}
            data-drag-over={dragOver}
            data-disabled={disabled}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const file = firstImage(event.dataTransfer);
              if (file) choose(file);
              else setPickError(errorText("bad_request"));
            }}
          >
            <input
              ref={fileInputRef}
              className={styles.fileInput}
              type="file"
              accept={ACCEPTED_MEDIA_TYPES.join(",")}
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) choose(file);
              }}
            />
            <NavIcon name="upload" width={28} height={28} style={{ color: "var(--accent-11)" }} />
            <Text size="3" weight="medium">
              <Box as="span" display={{ initial: "none", sm: "inline" }}>
                Drop a bank-log screenshot, paste it with Ctrl+V, or click to choose
              </Box>
              <Box as="span" display={{ initial: "inline", sm: "none" }}>
                Tap to choose a bank-log screenshot
              </Box>
            </Text>
            <Text size="2" color="gray">
              PNG, JPEG or WebP · up to 10 MB · reading takes 10–20 seconds
            </Text>
          </label>
          {pickError && (
            <Callout.Root color="red" size="1" role="alert">
              <Callout.Text>{pickError}</Callout.Text>
            </Callout.Root>
          )}
        </>
      ) : (
        <Grid columns={{ initial: "1", md: "minmax(0, 2fr) minmax(0, 3fr)" }} gap="5" align="start">
          <Flex direction="column" gap="2" className={styles.shot}>
            {/* A blob: preview of the user's own file; next/image has nothing to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.shotImage} src={shot.url} alt="The screenshot you chose" />
            <Text size="1" color="gray" truncate>
              {shot.file.name || "Pasted image"} · {formatBytes(shot.file.size)}
            </Text>
          </Flex>

          <Flex direction="column" gap="4" minWidth="0">
            {passcodeForm}

            {phase.name === "idle" && needsPasscode && (
              <Text size="2" color="gray">
                Enter the passcode, then press Read screenshot.
              </Text>
            )}

            {phase.name === "reading" && <Reading startedAt={phase.startedAt} />}

            {phase.name === "error" && (
              <Callout.Root color="red" role="alert">
                <Callout.Text weight="medium">{errorText(phase.kind)}</Callout.Text>
                {phase.detail && phase.detail !== errorText(phase.kind) && (
                  <Callout.Text size="1" style={{ overflowWrap: "anywhere" }}>
                    {phase.detail}
                  </Callout.Text>
                )}
              </Callout.Root>
            )}

            {phase.name === "done" && (
              <TryResult result={phase.body.result} durationMs={phase.body.durationMs} />
            )}

            <Flex gap="3" wrap="wrap">
              {phase.name === "error" && phase.kind !== "unauthorized" && phase.kind !== "disabled" && (
                <Button variant="soft" onClick={() => void run(shot.file, passcode.trim())}>
                  Retry
                </Button>
              )}
              <Button variant={phase.name === "done" ? "solid" : "soft"} color={reading ? "gray" : undefined} onClick={tryAnother}>
                {reading ? "Cancel" : "Try another"}
              </Button>
            </Flex>
          </Flex>
        </Grid>
      )}
    </Flex>
  );
}
