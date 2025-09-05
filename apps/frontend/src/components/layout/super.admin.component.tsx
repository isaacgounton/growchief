"use client";

import { useState, useCallback, useRef, useEffect, type FC } from "react";
import useSWR from "swr";
import { debounce } from "lodash";
import { useUser } from "@growchief/frontend/utils/store";
import { useFetch } from "@growchief/frontend/utils/use.fetch";
import { Input } from "@growchief/frontend/components/ui/input.tsx";
import { Select } from "@growchief/frontend/components/ui/select.tsx";
import { Button } from "@growchief/frontend/components/ui/button.tsx";

interface UserWithOrganization {
  organizationId: string;
  id: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

interface PricingPlan {
  identifier: string;
  name: string;
  month: {
    price: number;
    currency: string;
  };
  year: {
    price: number;
    currency: string;
  };
}

export const SuperAdminComponent = () => {
  const data = useUser();

  return (
    <ViewasComponentInner
      viewingAs={data?.viewas!}
      subscription={data?.org?.subscription}
    />
  );
};

export const ViewasComponentInner: FC<{
  viewingAs: string;
  subscription: any;
}> = (props) => {
  const { viewingAs, subscription } = props;
  const [current, setCurrent] = useState("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [total, setTotal] = useState<number>(1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fetch = useFetch();

  const debouncedSearch = useCallback(
    debounce((term: string) => {
      setSearchTerm(term);
      if (term.length > 0) {
        setIsDropdownOpen(true);
      } else {
        setIsDropdownOpen(false);
      }
    }, 300),
    [],
  );

  useEffect(() => {
    if (viewingAs) {
      fetchUsers(viewingAs).then((p) => {
        setCurrent(p[0].user.email);
      });
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const fetchUsers = useCallback(
    async (search: string) => {
      try {
        if (!search) return [];

        const response = await fetch(
          `/users/all-users?search=${encodeURIComponent(search)}`,
        );
        if (response.ok) {
          const data = await response.json();
          return data as UserWithOrganization[];
        }
        return [];
      } catch (error) {
        console.error("Failed to fetch users:", error);
        return [];
      }
    },
    [fetch],
  );

  const fetchPricing = useCallback(async () => {
    try {
      const response = await fetch("/billing/pricing");
      if (response.ok) {
        const data = await response.json();
        return data as PricingPlan[];
      }
      return [];
    } catch (error) {
      console.error("Failed to fetch pricing:", error);
      return [];
    }
  }, [fetch]);

  const { data: users, isLoading } = useSWR([`users-search`, searchTerm], () =>
    fetchUsers(searchTerm),
  );

  const { data: pricingPlans } = useSWR("pricing-plans", fetchPricing);

  const handleViewAs = async (userId: string) => {
    await fetch("/billing/view-as", {
      method: "POST",
      body: JSON.stringify({
        todo: userId === "reset" ? "reset" : "set",
        userId,
      }),
    });
    window.location.reload();
  };

  const handleAddPackage = async () => {
    if (!viewingAs || !selectedPlan) return;

    // Validate total is a positive number
    if (total <= 0) {
      alert("Total must be a positive number");
      return;
    }

    await fetch(`/billing/assign-package`, {
      method: "POST",
      body: JSON.stringify({
        plan: selectedPlan,
        total: total,
      }),
    });

    window.location.reload();
  };

  return (
    <div className="w-full bg-innerBackground mb-2 rounded-[8px] px-4 py-1 z-[500] relative">
      <div className="flex items-center justify-center max-w-[100rem] gap-2 mx-auto h-8">
        <div className="flex items-center justify-center gap-4">
          <span className="text-sm font-medium text-gray-300 flex items-center">
            {viewingAs ? "Viewing as:" : "View as:"}
          </span>

          <div className="flex items-center gap-2">
            <div className="relative" ref={dropdownRef}>
              <Input
                className="w-60 !h-[30px] pl-8 border-[#2a2a2a] bg-[#1f1f1f] text-gray-200 text-sm"
                placeholder="Search users..."
                {...(current ? { value: current } : {})}
                onChange={(e) => debouncedSearch(e.target.value)}
                onFocus={() => searchTerm.length > 0 && setIsDropdownOpen(true)}
              />

              {isDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full rounded-md bg-[#1f1f1f] border border-[#2a2a2a] shadow-lg max-h-60 overflow-auto">
                  {isLoading ? (
                    <div className="flex items-center justify-center p-3">
                      <span className="text-xs text-gray-400 ml-2">
                        Loading...
                      </span>
                    </div>
                  ) : (
                    <>
                      {users && users.length > 0 ? (
                        users.map((item) => (
                          <div
                            key={`${item.user.id}-${item.organizationId}`}
                            className="px-3 py-2 hover:bg-[#2a2a2a] cursor-pointer text-gray-300 text-sm"
                            onClick={() => handleViewAs(item.id)}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium text-white">
                                {item.user.email}
                              </span>
                              <span className="text-xs text-gray-400">
                                Org ID: {item.organizationId.substring(0, 20)}
                                ...
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-gray-400 text-sm">
                          No users found
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!!viewingAs && (
            <>
              {!subscription && (
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedPlan}
                    onChange={(e) => setSelectedPlan(e.target.value)}
                  >
                    <option value="">Select Plan</option>
                    {pricingPlans?.map((plan) => (
                      <option key={plan.identifier} value={plan.identifier}>
                        {plan.name} ({plan.identifier})
                      </option>
                    ))}
                  </Select>

                  <Input
                    type="number"
                    min="1"
                    value={total}
                    onChange={(e) => setTotal(parseInt(e.target.value) || 1)}
                    className="w-20 h-7 text-sm border-[#2a2a2a] bg-[#1f1f1f] text-gray-200"
                    placeholder="Amount"
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#2a2a2a] bg-[#1f1f1f] text-gray-300 hover:bg-[#2a2a2a] hover:text-white disabled:opacity-50"
                    onClick={handleAddPackage}
                    disabled={!selectedPlan}
                  >
                    Assign
                  </Button>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs border-[#2a2a2a] bg-[#1f1f1f] text-gray-300 hover:bg-[#2a2a2a] hover:text-white"
                onClick={() => handleViewAs("reset")}
              >
                You are in view mode - Reset View
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
