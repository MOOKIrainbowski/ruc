import StatusDashboard from "@/components/StatusDashboard";

import { banner } from "@/lib/og";

export const metadata = {
  title: "서버 상태",
  ...banner("status", "러크 서버 상태", "서버 · 접속자 실시간 상태."),
};

export default function Page() {
  return <StatusDashboard lang="ko" />;
}
