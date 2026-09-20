import { Callout, Code, Flex, Heading, Text } from "@radix-ui/themes";
import { fragmentLabel } from "@/catalog";
import { HeroStrip } from "@/components/progress/HeroStrip";
import { MaterialBar } from "@/components/progress/MaterialBar";
import { RecentDeposits } from "@/components/progress/RecentDeposits";
import { loadProgressPageData, type ProgressPageData } from "@/db/queries";
import { formatQty } from "@/lib/format";
import { sortByPctAscending } from "@/modules/progress";

// Live data on every request; never prerender the ledger at build time.
export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  let data: ProgressPageData;
  try {
    data = await loadProgressPageData();
  } catch (error) {
    return <DatabaseNotReady error={error} />;
  }

  const { itemsById, recipes, progress, lastSyncedAt } = data;

  const sharedBars = sortByPctAscending(progress.shared).flatMap((material) => {
    const item = itemsById.get(material.itemId);
    if (!item) return [];
    return [
      {
        key: item.id,
        item,
        have: formatQty(material.have),
        need: formatQty(material.need),
        pct: material.pct,
      },
    ];
  });

  const fragmentBars = progress.elites.flatMap((elite) => {
    const item = elite.fragmentItemId ? itemsById.get(elite.fragmentItemId) : undefined;
    if (!item) return [];
    const recipe = recipes.find((r) => r.eliteType === elite.eliteType);
    return [
      {
        key: elite.eliteType,
        item,
        label: `${recipe?.name ?? fragmentLabel(item)} fragments`,
        have: formatQty(elite.fragmentsHave),
        need: formatQty(elite.fragmentsNeed),
        pct: elite.fragmentsPct,
        craftable: elite.craftableNow,
      },
    ];
  });

  return (
    <Flex direction="column" gap="6">
      <HeroStrip
        elitesCrafted={progress.elitesCrafted}
        pctToNextElite={progress.pctToNextElite}
        sharedElitesWorth={progress.sharedElitesWorth}
        lastSynced={lastSyncedAt ? lastSyncedAt.toLocaleString("en-US") : null}
      />

      <Section title="Shared materials" subtitle="Bottleneck on top. Every Elite draws from the same pool.">
        {sharedBars.map((bar) => (
          <MaterialBar key={bar.key} item={bar.item} have={bar.have} need={bar.need} pct={bar.pct} />
        ))}
      </Section>

      <Section title="Blueprint fragments" subtitle="100 of the matching fragment per Elite.">
        {fragmentBars.map((bar) => (
          <MaterialBar
            key={bar.key}
            item={bar.item}
            label={bar.label}
            have={bar.have}
            need={bar.need}
            pct={bar.pct}
            craftable={bar.craftable}
          />
        ))}
      </Section>

      <Section title="Recent deposits">
        <RecentDeposits />
      </Section>
    </Flex>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Flex asChild direction="column" gap="4">
      <section aria-label={title}>
        <Flex direction="column" gap="1">
          <Heading size="4">{title}</Heading>
          {subtitle && (
            <Text size="2" color="gray">
              {subtitle}
            </Text>
          )}
        </Flex>
        {children}
      </section>
    </Flex>
  );
}

function DatabaseNotReady({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const missingTables = /does not exist/i.test(message);
  return (
    <Callout.Root color="amber" role="alert">
      <Callout.Text>
        {missingTables ? (
          <>
            The database has no tables yet. Run <Code>pnpm db:seed</Code> once, then reload.
          </>
        ) : (
          <>Could not read the database: {message}</>
        )}
      </Callout.Text>
    </Callout.Root>
  );
}
