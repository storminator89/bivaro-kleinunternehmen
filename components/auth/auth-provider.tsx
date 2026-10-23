"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { BankAllocationSessionScope } from "@/components/bank-csv/bank-allocation-session-scope";

interface AuthProviderProps {
  children: ReactNode;
}

export default function AuthProvider({ children }: AuthProviderProps) {
  return <SessionProvider><BankAllocationSessionScope />{children}</SessionProvider>;
}