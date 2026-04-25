export function PrivateDashboardMessage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#eefaf4_0,#f6f7f9_22rem,#f6f7f9_100%)] text-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-3 py-8 sm:px-6 sm:py-10">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:p-6">
          <p className="text-sm font-medium text-emerald-700">
            เงินรั่วตรงไหน
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-normal">
            ต้องใช้ลิงก์ส่วนตัวเพื่อเปิด Dashboard
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            ส่งคำว่า dashboard ใน LINE เพื่อรับลิงก์ที่มีสิทธิ์เข้าถึงข้อมูลของคุณ
          </p>
        </section>
      </div>
    </main>
  );
}
