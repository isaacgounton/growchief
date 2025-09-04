import {
  type FC,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ModeIcon } from "@growchief/frontend/components/icons/mode.icon.tsx";
import { MenuItem } from "@growchief/frontend/components/layout/menu.item.tsx";
import {
  bottomRoutes,
  routes,
  topRoutes,
} from "@growchief/frontend/routes.tsx";
import { Navigate, Route, Routes } from "react-router";
import { PageName } from "@growchief/frontend/components/layout/page.name.tsx";
import { useFetch } from "@growchief/frontend/utils/use.fetch.tsx";
import { useBearStore } from "@growchief/frontend/utils/store.ts";
import { useShallow } from "zustand/react/shallow";
import { SubRoutesContext } from "@growchief/frontend/utils/sub.routes.context.tsx";
import { JoinTeamModal } from "@growchief/frontend/components/team/join.team.modal.tsx";
import { OrganizationSelector } from "@growchief/frontend/components/layout/organization.selector.tsx";
import { ModalManager } from "@growchief/frontend/utils/modal.manager";
import { NotificationsComponent } from "@growchief/frontend/components/notifications/notifications.component.tsx";
import { CheckSubscription } from "@growchief/frontend/components/layout/check.subscription.tsx";
import { SuperAdminComponent } from "@growchief/frontend/components/layout/super.admin.component.tsx";
import { CreditsComponent } from "@growchief/frontend/components/layout/credits.component.tsx";
import clsx from "clsx";
import { OnboardingComponent } from "@growchief/frontend/components/onboarding/onboarding.component.tsx";

export const Layout: FC = () => {
  const fetch = useFetch();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, setUser } = useBearStore(
    useShallow((state) => ({ user: state.user, setUser: state.setUser })),
  );

  const loadUser = useCallback(async () => {
    const data = await (await fetch("/users/self")).json();
    setUser({ ...data, mutate: () => loadUser() });
  }, []);

  const memoRoutes = useMemo(() => {
    if (!user) {
      return {
        routes: [],
        topRoutes: [],
        bottomRoutes: [],
      };
    }

    return {
      routes: routes(user),
      topRoutes: topRoutes(user),
      bottomRoutes: bottomRoutes(user),
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      loadUser();
    }
  }, []);

  if (!user) {
    return null;
  }

  if (!user.org.subscription && !user.selfhosted) {
    return (
      <ModalManager>
        <div className="flex flex-1 flex-col">
          {user.isSuperAdmin && <SuperAdminComponent />}
          <CheckSubscription />
          <div className="blurMe flex flex-1 flex-col px-4 sm:px-6 lg:px-8">
            <JoinTeamModal />
            <Routes>
              {memoRoutes.routes
                .filter((f) => f.label === "Billing")
                .map((route) => (
                  <Fragment key={route.label}>
                    <Route {...route} path="*" />
                  </Fragment>
                ))}
            </Routes>
          </div>
        </div>
      </ModalManager>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {user.isSuperAdmin && <SuperAdminComponent />}
      <JoinTeamModal />
      <div className="flex gap-[8px] flex-1 relative">
        {/* Mobile Overlay */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div
          className={clsx(
            "bg-innerBackground rounded-[8px] pt-[20px] text-center select-none transition-all duration-300",
            // Mobile: slide in from left, full height overlay
            "max-lg:fixed max-lg:h-screen max-lg:top-0 lg:relative left-0 z-[999]",
            "w-[280px] lg:w-[86px]",
            // Mobile menu visibility
            isMobileMenuOpen
              ? "max-lg:translate-x-0"
              : "max-lg:-translate-x-full",
          )}
        >
          <div
            className={clsx(
              "lg:fixed lg:left-[17px] lg:top-0 blurMe h-full pt-[32px] pb-[15px] px-[8px] flex flex-col gap-[32px]",
              user.isSuperAdmin && "pt-[85px]",
            )}
          >
            {/* Mobile close button */}
            <button
              className="absolute top-4 right-4 lg:hidden text-secondary hover:text-primary transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            <div className="flex justify-center items-center">
              <div className="w-[60px] h-[60px] rounded-full overflow-hidden logo-shadow">
                <img
                  src="/logo.svg"
                  alt="Logo"
                  className="w-full h-full object-cover rounded-full overflow-hidden"
                />
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              <div className="flex flex-1 flex-col gap-[8px] lg:gap-[16px]">
                {memoRoutes.topRoutes
                  .filter((f) => f.menu)
                  .map((route) => (
                    <MenuItem
                      key={route.label}
                      label={route.label}
                      to={route.path?.split("/")[1]!}
                      icon={route.icon}
                      onClick={() => setIsMobileMenuOpen(false)}
                    />
                  ))}
              </div>
              <div className="flex flex-col gap-[8px] lg:gap-[16px]">
                {memoRoutes.bottomRoutes
                  .filter((f) => f.menu)
                  .map((route) => (
                    <MenuItem
                      key={route.label}
                      label={route.label}
                      to={route.path?.split("/")[1]!}
                      icon={route.icon}
                      onClick={() => setIsMobileMenuOpen(false)}
                    />
                  ))}
              </div>
            </div>
          </div>
        </div>
        <ModalManager>
          <OnboardingComponent />
          <div className="flex-1 flex flex-col gap-[1px] min-w-0">
            <div className="h-[80px] flex bg-innerBackground rounded-t-[8px] px-[12px] sm:px-[20px] items-center text-[18px] sm:text-[24px] font-[600]">
              {/* Mobile hamburger menu */}
              <button
                className="lg:hidden mr-4 text-secondary hover:text-primary transition-colors"
                onClick={() => setIsMobileMenuOpen(true)}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>

              <div className="flex flex-1 min-w-0">
                <PageName />
              </div>
              <div className="select-none flex flex-row-reverse text-secondary gap-[12px] sm:gap-[20px]">
                <NotificationsComponent />
                <div className="hidden sm:block w-[1px] h-[24px] bg-secondary/20" />
                <ModeIcon />
                <div className="hidden lg:block w-[1px] h-[24px] bg-secondary/20" />
                <div className="hidden sm:block">
                  <OrganizationSelector />
                </div>
                <div className="hidden lg:flex justify-center">
                  <CreditsComponent />
                </div>
              </div>
            </div>
            <div className="rounded-b-[8px] flex-1 min-h-0 flex">
              <Routes>
                <Route
                  path="/auth/*"
                  element={<Navigate to="/analytics" replace />}
                />
                <Route
                  path="/"
                  element={<Navigate to="/analytics" replace />}
                />
                {memoRoutes.routes.map((route) => (
                  <Route
                    {...route}
                    element={
                      <SubRoutesContext.Provider
                        key={route.label}
                        value={{ routes: route?.sub || [] }}
                      >
                        {route.element}
                      </SubRoutesContext.Provider>
                    }
                  />
                ))}
              </Routes>
            </div>
          </div>
        </ModalManager>
      </div>
    </div>
  );
};
