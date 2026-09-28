export function accountCodeFor(user) {
  return String(
    user.accountCode || user.custodianCodes?.[0] || user.email || "",
  ).trim();
}
