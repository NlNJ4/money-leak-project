import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { BudgetSettings } from "@/components/dashboard/budget-settings";
import { CategoryBarList } from "@/components/dashboard/category-bar-list";
import { DailyTrend } from "@/components/dashboard/daily-trend";
import { ExpenseList } from "@/components/dashboard/expense-list";
import { LeakInsightList } from "@/components/dashboard/leak-insight-list";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatusPill } from "@/components/dashboard/status-pill";
import { SubscriptionInsightList } from "@/components/dashboard/subscription-insight-list";
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

export function DashboardView({
  summary,
  accessToken,
}: {
  summary: DashboardSummary;
  accessToken?: string | null;
}) {
  const hasOverDailyBudget = summary.dailyRemainingBaht < 0;
  const hasOverMonthlyBudget = summary.monthlyRemainingBaht < 0;
  const weeklyBudgetTargetBaht = summary.dailyBudgetBaht * 7;
  const weeklyDetail = summary.weekTopCategory
    ? `เฉลี่ยวันละ ${formatBaht(summary.weekAverageBaht)} | สูงสุด ${summary.weekTopCategory.label}`
    : "ยังไม่มีรายการใน 7 วันล่าสุด";

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#eefaf4_0,#f6f7f9_22rem,#f6f7f9_100%)] text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-6 sm:py-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-emerald-100 pb-5 pt-1 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-emerald-700">
              เงินรั่วตรงไหน
            </p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-normal text-zinc-950 md:text-4xl">
              Dashboard รายจ่าย
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 sm:mt-3">
              อัปเดตล่าสุด {formatAsOf(summary.asOf)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 min-[520px]:flex min-[520px]:flex-wrap min-[520px]:justify-end">
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

        <section className="grid gap-3 min-[520px]:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
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
            label="7 วันล่าสุด"
            value={formatBaht(summary.weekTotalBaht)}
            detail={weeklyDetail}
            tone={
              summary.weekTotalBaht === 0
                ? "neutral"
                : summary.weekTotalBaht > weeklyBudgetTargetBaht
                  ? "warning"
                  : "info"
            }
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

        <section className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
          <div className="grid gap-4 sm:gap-6">
            <SectionPanel title="งบที่ใช้ไป">
              <BudgetSettings
                accessToken={accessToken}
                dailyBudgetBaht={summary.dailyBudgetBaht}
                lineUserId={summary.lineUserId}
                monthlyBudgetBaht={summary.monthlyBudgetBaht}
              />
              <div className="grid gap-5 md:grid-cols-2">
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

            <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
              <SectionPanel title="รายจ่ายตามหมวด">
                <CategoryBarList categories={summary.categoryTotals} />
              </SectionPanel>
              <SectionPanel title="แนวโน้ม 7 วัน">
                <DailyTrend days={summary.dailyTrend} />
              </SectionPanel>
            </div>
          </div>

          <div className="grid gap-4 sm:gap-6">
            <SectionPanel title="เงินรั่วที่ควรจับตา">
              <LeakInsightList insights={summary.leakInsights} />
            </SectionPanel>
            <SectionPanel title="รายจ่ายซ้ำ">
              <SubscriptionInsightList insights={summary.recurringInsights} />
            </SectionPanel>
            <SectionPanel title="รายการล่าสุด">
              <ExpenseList
                accessToken={accessToken}
                expenses={summary.recentExpenses}
                lineUserId={summary.lineUserId}
              />
            </SectionPanel>
          </div>
        </section>
      </div>
    </main>
  );
}
