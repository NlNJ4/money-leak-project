export function PrivateDashboardMessage() {
  return (
    <main className="min-h-screen bg-[#f6f7f9] text-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
        <section className="border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-emerald-700">
            เงินรั่วตรงไหน
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal">
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
