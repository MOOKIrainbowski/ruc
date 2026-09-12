import StatusDashboard from "@/components/StatusDashboard";

export const metadata = { title: { absolute: "Server Status · Ruc Server" } };

export default function Page() {
  return <StatusDashboard lang="en" />;
}
