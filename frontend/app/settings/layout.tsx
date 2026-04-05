"use client";

import { Settings2, Tv } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const sidebarNavItems = [
  {
    title: "Generale",
    href: "/settings/",
    icon: Settings2,
  },
  {
    title: "Sonarr",
    href: "/settings/sonarr",
    icon: Tv,
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6 pb-16">
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Impostazioni</h2>
        <p className="text-muted-foreground">
          Gestisci le impostazioni dell&apos;applicazione e le preferenze.
        </p>
      </div>
      <Separator className="my-6" />
      <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
        <aside className="lg:w-1/5">
          <Card className="p-2">
            <nav className="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1">
              {sidebarNavItems.map((item) => {
                const Icon = item.icon;
                // Special case for /settings: only match exact path
                // For other paths: match exact or child paths
                const isActive = item.href === "/settings"
                  ? pathname === "/settings"
                  : (pathname === item.href || pathname.startsWith(item.href + "/"));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      buttonVariants({ variant: "ghost" }),
                      isActive
                        ? "bg-muted hover:bg-muted border-primary font-medium"
                        : "hover:bg-muted/50 border-transparent",
                      "justify-start"
                    )}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.title}
                  </Link>
                );
              })}
            </nav>
          </Card>
        </aside>
        <div className="flex-1 lg:max-w-4xl">{children}</div>
      </div>
    </div>
  );
}
