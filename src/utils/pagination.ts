export const toPagination = (page = 1, limit = 20) => {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  const safePage = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 20;
  return { offset: (safePage - 1) * safeLimit, limit: safeLimit, page: safePage };
};
