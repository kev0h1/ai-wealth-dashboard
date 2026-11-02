export type TransactionSearchRouteState = {
  query: string;
  page: number;
};

/**
 * The transaction hub owns q/page in its address. Filters deliberately stay
 * as independent query parameters, so a link can combine either kind of
 * criteria without one silently replacing the other.
 */
export function readTransactionSearchRoute(params: Pick<URLSearchParams, "get">): TransactionSearchRouteState {
  const query = (params.get("q") ?? "").trim();
  const parsedPage = Number.parseInt(params.get("page") ?? "1", 10);
  return { query, page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1 };
}

export function writeTransactionSearchRoute(params: URLSearchParams, state: TransactionSearchRouteState): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("q");
  next.delete("page");
  if (state.query) next.set("q", state.query);
  if (state.page > 1) next.set("page", String(state.page));
  return next;
}
