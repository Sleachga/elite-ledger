"use client";

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { Dialog, Flex, Popover, Text, TextField, VisuallyHidden } from "@radix-ui/themes";
import { catalog, fragmentLabel, iconUrl, rarityColor, type CatalogItem } from "@/catalog";
import { UNKNOWN_ITEM_ID } from "@/modules/playground/review";
import styles from "./Review.module.css";

interface Option {
  id: string;
  /** Under the icon. Fragments drop the "[Blueprint Fragment]" prefix: the group title says it. */
  name: string;
  /** Fragments: the Elite they belong to ("Ring"). */
  caption?: string;
  item?: CatalogItem;
  /** Lower-case text the filter looks in. */
  haystack: string;
}

interface Group {
  title: string;
  options: Option[];
  /** A group that only ever holds one tile. */
  single?: boolean;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function optionOf(item: CatalogItem): Option {
  const caption = item.eliteType ? capitalize(item.eliteType) : undefined;
  return {
    id: item.id,
    name: item.kind === "fragment" ? fragmentLabel(item) : item.name,
    caption,
    item,
    haystack: [item.name, item.id, caption ?? "", ...item.aliases].join(" ").toLowerCase(),
  };
}

const UNKNOWN_OPTION: Option = {
  id: UNKNOWN_ITEM_ID,
  name: "Unknown / not tracked",
  haystack: "unknown not tracked other none",
};

/** Fragments first (the hard ones), then materials, then currency, then "unknown". */
const GROUPS: readonly Group[] = [
  { title: "Blueprint fragments", options: catalog.filter((item) => item.kind === "fragment").map(optionOf) },
  { title: "Materials", options: catalog.filter((item) => item.kind === "material").map(optionOf) },
  { title: "Currency", options: catalog.filter((item) => item.kind === "currency").map(optionOf), single: true },
  { title: "Other", options: [UNKNOWN_OPTION], single: true },
];

function Tile({
  option,
  current,
  active,
  onPick,
}: {
  option: Option;
  current: boolean;
  active: boolean;
  onPick: () => void;
}) {
  const color = option.item ? rarityColor(option.item.rarity) : "gray";
  const vars = { "--tile-border": `var(--${color}-8)`, "--tile-fill": `var(--${color}-a3)` } as CSSProperties;
  return (
    <button
      type="button"
      className={styles.tile}
      data-current={current}
      data-active={active}
      data-tile={option.id}
      aria-pressed={current}
      title={option.item?.name ?? option.name}
      onClick={onPick}
    >
      <span className={styles.tileIcon} style={vars} data-unknown={!option.item}>
        {option.item ? <Image src={iconUrl(option.item)} alt="" width={56} height={56} /> : "?"}
      </span>
      <span className={styles.tileName}>{option.name}</span>
      {option.caption && <span className={styles.tileCaption}>{option.caption}</span>}
    </button>
  );
}

/**
 * The inside of the picker: optional enlarged strip of the row, a filter, and
 * large icon tiles by group. Type to filter, ↑/↓ to move, Enter to select.
 */
function PickerBody({
  value,
  strip,
  autoFocusFilter,
  onPick,
}: {
  value: string;
  strip?: ReactNode;
  autoFocusFilter: boolean;
  onPick: (itemId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);

  const groups = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return GROUPS.map((group) => ({
      ...group,
      options: group.options.filter((option) => words.every((word) => option.haystack.includes(word))),
    })).filter((group) => group.options.length > 0);
  }, [filter]);

  const visible = groups.flatMap((group) => group.options);
  // Enter takes the tile the arrows are on; before any arrow, the current item, else the first match.
  const active =
    visible.find((option) => option.id === cursor) ??
    (filter === "" ? visible.find((option) => option.id === value) : undefined) ??
    visible[0];

  function move(step: number) {
    if (visible.length === 0) return;
    const index = active ? visible.indexOf(active) : -1;
    const next = visible[(index + step + visible.length) % visible.length];
    setCursor(next.id);
    document.querySelector(`[data-tile="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className={styles.picker}>
      {strip}
      <TextField.Root
        size="2"
        placeholder="Type to filter…"
        aria-label="Filter items"
        autoComplete="off"
        autoFocus={autoFocusFilter}
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
          setCursor(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (active) onPick(active.id);
          }
        }}
      />
      {groups.length === 0 && (
        <Text size="2" color="gray">
          No tracked item matches “{filter}”.
        </Text>
      )}
      <div className={styles.groups}>
        {groups.map((group) => (
          <Flex key={group.title} direction="column" gap="2" asChild>
            {/* One-tile groups (currency, unknown) sit side by side instead of taking a row each. */}
            <section aria-label={group.title} data-single={group.single}>
              <Text size="1" color="gray" weight="medium" className={styles.groupTitle}>
                {group.title}
              </Text>
              <div className={styles.tileGrid}>
                {group.options.map((option) => (
                  <Tile
                    key={option.id}
                    option={option}
                    current={option.id === value}
                    active={option === active}
                    onPick={() => onPick(option.id)}
                  />
                ))}
              </div>
            </section>
          </Flex>
        ))}
      </div>
    </div>
  );
}

/**
 * Pick the item of a row from large icon tiles. A popover beside the trigger
 * on desktop, a bottom sheet on phones (`sheet`). `strip` is shown on top:
 * the row as it looks on the screenshot, to compare the real icon with the
 * tiles. The trigger is whatever is passed as children (an ItemChip).
 */
export function ItemPicker({
  value,
  label,
  sheet,
  strip,
  children,
  onSelect,
}: {
  /** Current item id ("unknown" included; "" when nothing is chosen yet). */
  value: string;
  /** For screen readers: "Item of row 3: Gold Ingot". */
  label: string;
  sheet: boolean;
  strip?: ReactNode;
  children: ReactNode;
  onSelect: (itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement | null>(null);

  const pick = (itemId: string) => {
    setOpen(false);
    onSelect(itemId);
  };

  const trigger = (
    <button type="button" className={`${styles.editTrigger} ${styles.editStart}`} aria-label={`${label}. Change`} title="Click to change the item">
      {children}
    </button>
  );

  if (sheet) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger>{trigger}</Dialog.Trigger>
        <Dialog.Content
          ref={content}
          className={styles.sheet}
          size="2"
          aria-describedby={undefined}
          // No keyboard popping up over the tiles: focus the current tile, not the filter.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const root = content.current;
            const target =
              root?.querySelector<HTMLElement>('[data-tile][data-current="true"]') ??
              root?.querySelector<HTMLElement>("[data-tile]");
            // Without scrolling to it: the sheet opens on the strip and the fragments.
            (target ?? root)?.focus({ preventScroll: true });
          }}
        >
          <Flex align="center" justify="between" gap="3" mb="3">
            <Dialog.Title size="3" mb="0">
              Pick the item
            </Dialog.Title>
            <Dialog.Close>
              <button type="button" className={styles.editTrigger}>
                <Text size="2" color="gray">
                  Close
                </Text>
              </button>
            </Dialog.Close>
          </Flex>
          <PickerBody value={value} strip={strip} autoFocusFilter={false} onPick={pick} />
        </Dialog.Content>
      </Dialog.Root>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>{trigger}</Popover.Trigger>
      <Popover.Content
        size="2"
        width="480px"
        maxWidth="calc(100vw - 32px)"
        // Never taller than the room beside the trigger: the strip and the fragments lead, the rest scrolls.
        maxHeight="var(--radix-popover-content-available-height)"
        align="start"
        sideOffset={6}
        collisionPadding={12}
      >
        <VisuallyHidden>
          <h3>Pick the item</h3>
        </VisuallyHidden>
        <PickerBody value={value} strip={strip} autoFocusFilter onPick={pick} />
      </Popover.Content>
    </Popover.Root>
  );
}
