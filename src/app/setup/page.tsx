import { getUserCount } from "@/lib/db";
import { redirect } from "next/navigation";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "초기 마스터 관리자 설정 - Anihub",
};

export default async function SetupPage() {
  const count = await getUserCount();
  if (count > 0) {
    // 이미 계정이 하나라도 존재하면 셋업 진입 불가 -> 로그인 페이지로 리다이렉트
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060913] px-4 py-12 safe-top safe-bottom safe-x">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0d1426]/70 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        {/* 상단 브랜딩 */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3.5 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/20 bg-gradient-to-tr from-emerald-500/10 to-blue-500/10 shadow-inner">
            <span className="text-3xl">⚙️</span>
          </div>
          <h1 className="bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-2xl font-extrabold tracking-wide text-transparent sm:text-3xl">
            ADMIN SETUP
          </h1>
          <p className="mt-1 text-xs font-medium text-emerald-400">
            최초 마스터 관리자 설정
          </p>
          <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
            최초 1회에 한해 최고 권한을 가진 마스터 관리자 계정을 생성합니다.
            설정 완료 후 바로 시스템에 로그인됩니다.
          </p>
        </div>

        {/* 셋업 폼 */}
        <SetupForm />
      </div>
    </div>
  );
}
