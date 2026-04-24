import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { CategoryBarList } from "@/components/dashboard/category-bar-list";
import { DailyTrend } from "@/components/dashboard/daily-trend";
import { ExpenseList } from "@/components/dashboard/expense-list";
import { LeakInsightList } from "@/components/dashboard/leak-insight-list";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatusPill } from "@/components/dashboard/status-pill";
import { formatBaht } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types";

function getBudgetTone(remainingBaht: number) {
  if (remainingBaht < 0) return "danger";
  if (remainingBaht <= 50) return "warning";

  return "good";
}

function getLeakScoreTone(score: number) {
  if (score < 50) return "danger";
  if (score < 75) return "warning";

  return "good";
}

function formatAsOf(isoDate: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(isoDate));
}

export function DashboardView({ summary }: { summary: DashboardSummary }) {
  const hasOverDailyBudget = summary.dailyRemainingBaht < 0;
  const hasOverMonthlyBudget = summary.monthlyRemainingBaht < 0;

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-emerald-700">
              เงินรั่วตรงไหน
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-zinc-950 md:text-4xl">
              Dashboard รายจ่าย
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
              อัปเดตล่าสุด {formatAsOf(summary.asOf)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.dataMode === "demo" ? (
              <StatusPill tone="neutral">ข้อมูลตัวอย่าง</StatusPill>
            ) : null}
            <StatusPill tone={hasOverDailyBudget ? "danger" : "good"}>
              {hasOverDailyBudget ? "วันนี้เกินงบ" : "วันนี้ยังอยู่ในงบ"}
            </StatusPill>
            <StatusPill tone={hasOverMonthlyBudget ? "danger" : "info"}>
              {hasOverMonthlyBudget ? "เดือนนี้เกินงบ" : "ติดตามเดือนนี้"}
            </StatusPill>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="ใช้วันนี้"
            value={formatBaht(summary.todayTotalBaht)}
            detail={`งบวันนี้ ${formatBaht(summary.dailyBudgetBaht)}`}
            tone={getBudgetTone(summary.dailyRemainingBaht)}
          />
          <MetricCard
            label="ใช้เดือนนี้"
            value={formatBaht(summary.monthTotalBaht)}
            detail={`งบเดือนนี้ ${formatBaht(summary.monthlyBudgetBaht)}`}
            tone={getBudgetTone(summary.monthlyRemainingBaht)}
          />
          <MetricCard
            label="คาดการณ์สิ้นเดือน"
            value={formatBaht(summary.projectedMonthTotalBaht)}
            detail={
              summary.projectedMonthTotalBaht > summary.monthlyBudgetBaht
                ? "แนวโน้มสูงกว่างบรายเดือน"
                : "แนวโน้มยังต่ำกว่างบรายเดือน"
            }
            tone={
              summary.projectedMonthTotalBaht > summary.monthlyBudgetBaht
                ? "warning"
                : "info"
            }
          />
          <MetricCard
            label="Leak score"
            value={`${summary.leakScore}/100`}
            detail={
              summary.leakScore >= 75
                ? "คุมรายจ่ายได้ดี"
                : "มีหมวดที่ควรลดก่อน"
            }
            tone={getLeakScoreTone(summary.leakScore)}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="grid gap-6">
            <SectionPanel title="งบที่ใช้ไป">
              <div className="grid gap-6 md:grid-cols-2">
                <BudgetProgress
                  label="งบรายวัน"
                  usedBaht={summary.todayTotalBaht}
                  budgetBaht={summary.dailyBudgetBaht}
                />
                <BudgetProgress
                  label="งบรายเดือน"
                  usedBaht={summary.monthTotalBaht}
                  budgetBaht={summary.monthlyBudgetBaht}
                />
              </div>
            </SectionPanel>

            <div className="grid gap-6 lg:grid-cols-2">
              <SectionPanel title="รายจ่ายตามหมวด">
                <CategoryBarList categories={summary.categoryTotals} />
              </SectionPanel>
              <SectionPanel title="แนวโน้ม 7 วัน">
                <DailyTrend days={summary.dailyTrend} />
              </SectionPanel>
            </div>
          </div>

          <div className="grid gap-6">
            <SectionPanel title="เงินรั่วที่ควรจับตา">
              <LeakInsightList insights={summary.leakInsights} />
            </SectionPanel>
            <SectionPanel title="รายการล่าสุด">
              <ExpenseList expenses={summary.recentExpenses} />
            </SectionPanel>
          </div>
        </section>
      </div>
    </main>
  );
}
