/** `{ items, page, pageSize, total }`, the API's paginated list shape. */
export interface PagedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}
