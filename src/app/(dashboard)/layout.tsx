import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { BreadcrumbProvider } from "@/contexts/breadcrumb-context";
import { redirect } from "next/navigation";
import {
  getAuthenticatedSession,
  getAuthenticatedGroups,
  getAuthenticatedRepos,
} from "@/lib/db/helpers";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthenticatedSession();
  if (!session) redirect("/login");

  const [groups, repos] = await Promise.all([
    getAuthenticatedGroups(session.userId),
    getAuthenticatedRepos(session.userId),
  ]);

  // GitLab is considered enabled if the PAT is set
  const gitlabEnabled = !!process.env.GITLAB_PAT;

  return (
    <BreadcrumbProvider>
      <SidebarProvider>
        <AppSidebar
          groups={groups}
          repos={repos}
          userEmail={session.email}
          gitlabEnabled={gitlabEnabled}
        />
        <SidebarInset>
          <AppHeader />
          <div className="min-w-0 max-w-full flex-1 overflow-x-hidden pt-4 pr-4 pb-4">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbProvider>
  );
}
