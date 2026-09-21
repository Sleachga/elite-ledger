import Image from "next/image";
import { Badge, Flex, Text } from "@radix-ui/themes";
import { iconUrl, rarityColor, type CatalogItem } from "@/catalog";

export type ItemChipItem = Pick<CatalogItem, "name" | "rarity" | "icon">;

const SIZE_PX = { sm: 20, md: 24, lg: 40 } as const;

export interface ItemChipProps {
  item: ItemChipItem;
  /** sm 20px, md 24px (tables/lists), lg 40px (Progress bars). */
  size?: keyof typeof SIZE_PX;
  /** Override the visible name; the full item name is always on hover. */
  label?: string;
  /** Pre-formatted quantity badge, e.g. "20,000". */
  qty?: string;
  hideName?: boolean;
}

/**
 * The one item component: icon with a 1px rarity-colored border, name,
 * optional qty badge, full name on hover. Rarity -> color comes from the
 * catalog, never from here.
 */
export function ItemChip({ item, size = "md", label, qty, hideName = false }: ItemChipProps) {
  const px = SIZE_PX[size];
  const color = rarityColor(item.rarity);
  const textSize = size === "lg" ? "3" : "2";

  return (
    <Flex align="center" gap={size === "lg" ? "3" : "2"} title={item.name} minWidth="0">
      <span
        style={{
          width: px,
          height: px,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: size === "lg" ? 3 : 1,
          borderRadius: size === "lg" ? "var(--radius-3)" : "var(--radius-2)",
          border: `1px solid var(--${color}-8)`,
          background: `var(--${color}-a3)`,
          overflow: "hidden",
        }}
      >
        <Image
          src={iconUrl(item)}
          alt=""
          width={px}
          height={px}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </span>
      {!hideName && (
        <Text size={textSize} weight={size === "lg" ? "medium" : "regular"} truncate>
          {label ?? item.name}
        </Text>
      )}
      {qty !== undefined && (
        <Badge color={color} variant="soft" size="1" style={{ flexShrink: 0 }}>
          {qty}
        </Badge>
      )}
    </Flex>
  );
}

/**
 * Stand-in chip for a row whose icon matched no tracked item (the extractor's
 * "unknown"). Same footprint as ItemChip; dashed gray border, no icon.
 */
export function UnknownItemChip({
  size = "md",
  qty,
  title = "Not one of the tracked items, or the icon could not be told apart",
}: Pick<ItemChipProps, "size" | "qty"> & { title?: string }) {
  const px = SIZE_PX[size ?? "md"];

  return (
    <Flex align="center" gap={size === "lg" ? "3" : "2"} title={title} minWidth="0">
      <span
        aria-hidden
        style={{
          width: px,
          height: px,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: size === "lg" ? "var(--radius-3)" : "var(--radius-2)",
          border: "1px dashed var(--gray-8)",
          background: "var(--gray-a3)",
          color: "var(--gray-11)",
          fontSize: Math.round(px * 0.6),
          lineHeight: 1,
        }}
      >
        ?
      </span>
      <Text size={size === "lg" ? "3" : "2"} color="gray" style={{ fontStyle: "italic" }} truncate>
        Unknown item
      </Text>
      {qty !== undefined && (
        <Badge color="gray" variant="soft" size="1" style={{ flexShrink: 0 }}>
          {qty}
        </Badge>
      )}
    </Flex>
  );
}
