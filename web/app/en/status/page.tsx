import StatusDashboard from "@/components/StatusDashboard";

import { banner } from "@/lib/og";

export const metadata = {
  title: { absolute: "Server Status · Ruc Server" },
  ...banner("status", "Ruc Server Status", "Live server and player status."),
};

export default function Page() {
  return <StatusDashboard lang="en" />;
}
