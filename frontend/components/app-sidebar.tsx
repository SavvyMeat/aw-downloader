"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Home,
  List,
  Settings,
  Download,
  Clock,
  ChevronRight,
  Settings2,
  Server,
  Tv,
  Film,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fetchAppVersion } from "@/lib/api";

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Lista Serie",
    url: "/series",
    icon: Tv,
  },
  {
    title: "Film",
    url: "/films",
    icon: Film,
  },
  {
    title: "Tasks",
    url: "/tasks",
    icon: Clock,
  },
];

const settingsItems = [
  {
    title: "Generale",
    url: "/settings/",
    icon: Settings2,
  },
  {
    title: "Sonarr",
    url: "/settings/sonarr",
    icon: Tv,
  },
  {
    title: "Radarr",
    url: "/settings/radarr",
    icon: Film,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const [version, setVersion] = React.useState<string>("dev");
  const isSettingsActive = pathname.startsWith("/settings");
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(isSettingsActive);
  const isSidebarCollapsed = state === "collapsed";

  React.useEffect(() => {
    fetchAppVersion()
      .then((data) => setVersion(data.version))
      .catch(() => setVersion("dev"));
  }, []);

  React.useEffect(() => {
    if (isSettingsActive) {
      setIsSettingsOpen(true);
    }
  }, [isSettingsActive]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Download className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    AW Downloader
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {version}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {menuItems.map((item) => {
            // Match exact path or paths that start with item.url + "/"
            const isActive = pathname === item.url || 
              (item.url !== "/" && pathname.startsWith(item.url + "/"));
            return (
              <SidebarMenuItem key={item.title} className="px-2">
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.title}
                >
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
          
          {/* Settings Menu - Dropdown when collapsed, Collapsible when expanded */}
          {isSidebarCollapsed ? (
            <SidebarMenuItem className="px-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    tooltip="Impostazioni"
                    isActive={isSettingsActive}
                  >
                    <Settings />
                    <span>Impostazioni</span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" className="w-48">
                  {settingsItems.map((item) => {
                    const isActive = item.url === "/settings"
                      ? pathname === "/settings"
                      : (pathname === item.url || pathname.startsWith(item.url + "/"));
                    return (
                      <DropdownMenuItem key={item.title} asChild>
                        <Link 
                          href={item.url} 
                          className={cn(
                            "flex items-center gap-2",
                            isActive && "bg-accent font-medium"
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          ) : (
            <Collapsible
              open={isSettingsOpen}
              onOpenChange={setIsSettingsOpen}
              className="group/collapsible"
            >
              <SidebarMenuItem className="px-2">
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip="Impostazioni"
                    isActive={isSettingsActive}
                  >
                    <Settings />
                    <span>Impostazioni</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {settingsItems.map((item) => {
                      const isActive = item.url === "/settings"
                        ? pathname === "/settings"
                        : (pathname === item.url || pathname.startsWith(item.url + "/"));
                      return (
                        <SidebarMenuSubItem key={item.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive}
                          >
                            <Link href={item.url}>
                              <item.icon />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          )}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
            <SidebarMenuButton size="sm" className="text-xs text-muted-foreground">
              <span>Made with 🤖</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
