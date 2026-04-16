"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ChevronRight,
  Eye,
  Map,
  BookOpen,
  FileText,
  Shield,
  PlusIcon,
  Gitlab,
} from "lucide-react";
import { Collapsible } from "radix-ui";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AddRepoDialog } from "@/components/layout/add-repo-dialog";
import { UserMenu } from "@/components/layout/user-menu";
import { getGroupHref } from "@/lib/repo-routes";
import type { GroupConfig, RepoConfig } from "@/lib/types";

const SUPER_ADMIN_EMAIL = "dev@dahmani.fr";

interface AppSidebarProps {
  groups: GroupConfig[];
  repos: RepoConfig[];
  userEmail?: string;
  gitlabEnabled?: boolean;
}

const projectTabs = [
  { label: "Overview", segment: "", icon: Eye },
  { label: "Epics", segment: "epics", icon: Map },
  { label: "Stories", segment: "stories", icon: BookOpen },
  { label: "Library", segment: "docs", icon: FileText },
];

export function AppSidebar({ groups, repos, userEmail, gitlabEnabled }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Track which repo key is expanded — only one at a time
  const activeRepoKey = useMemo(
    () => groups.find((group) => pathname.startsWith(getGroupHref(group.sourceType, group.id))),
    [groups, pathname]
  );
  const derivedOpenRepo = activeRepoKey
    ? activeRepoKey.id
    : null;
  const [openRepo, setOpenRepo] = useState<string | null>(derivedOpenRepo);

  // Sync with route changes (e.g. navigating via links outside sidebar)
  if (derivedOpenRepo && derivedOpenRepo !== openRepo) {
    setOpenRepo(derivedOpenRepo);
  }

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="border-b border-border/50 px-6 py-4 group-data-[collapsible=icon]:px-2">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo_mybmad.png"
            alt="MyBMAD"
            width={32}
            height={32}
            className="shrink-0 rounded-lg"
          />
          <span className="font-semibold text-lg group-data-[collapsible=icon]:hidden">MyBMAD</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/"} tooltip="Dashboard">
                  <Link href="/">
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {groups.map((group) => {
                const basePath = getGroupHref(group.sourceType, group.id);
                const isRepoActive = pathname.startsWith(basePath);

                const repoKey = group.id;

                return (
                  <Collapsible.Root
                    key={repoKey}
                    open={openRepo === repoKey}
                    onOpenChange={(open) => {
                      setOpenRepo(open ? repoKey : null);
                      if (open && !isRepoActive) {
                        router.push(basePath);
                      }
                    }}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <Collapsible.Trigger asChild>
                        <SidebarMenuButton isActive={isRepoActive} tooltip={group.displayName}>
                          <Gitlab className="h-4 w-4" />
                          <span>{group.displayName}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </Collapsible.Trigger>
                      <Collapsible.Content className="group-data-[collapsible=icon]:hidden">
                        <SidebarMenuSub>
                          {projectTabs.map((tab) => {
                            const tabHref = tab.segment
                              ? `${basePath}/${tab.segment}`
                              : basePath;
                            const isTabActive = tab.segment === ""
                              ? pathname === basePath || pathname === basePath + "/"
                              : pathname.startsWith(`${basePath}/${tab.segment}`);

                            return (
                              <SidebarMenuSubItem key={tab.segment || "overview"}>
                                <SidebarMenuSubButton asChild isActive={isTabActive}>
                                  <Link
                                    href={tabHref}
                                    onClick={() => {
                                      if (isTabActive) {
                                        window.dispatchEvent(new CustomEvent("section-reset"));
                                      }
                                    }}
                                  >
                                    <tab.icon className="h-3.5 w-3.5" />
                                    <span>{tab.label}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </Collapsible.Content>
                    </SidebarMenuItem>
                  </Collapsible.Root>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="space-y-2 px-1 pb-2 group-data-[collapsible=icon]:hidden">
          <AddRepoDialog
            importedRepos={repos}
            importedGroups={groups}
            gitlabEnabled={gitlabEnabled}
            trigger={
              <Button variant="outline" size="lg" className="w-full">
                <PlusIcon aria-hidden="true" />
                Add New Project
              </Button>
            }
          />
          {userEmail === SUPER_ADMIN_EMAIL && (
            <Button variant="outline" size="lg" className="w-full" asChild>
              <Link href="/admin">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Admin
              </Link>
            </Button>
          )}
        </div>
        <div className="border-t border-border/50 pt-2">
          <UserMenu />
        </div>
        <div className="border-t border-border/50 pt-2 pb-1 text-center group-data-[collapsible=icon]:hidden">
          <p className="text-xs text-muted-foreground">Made with ❤️ by Hichem</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
