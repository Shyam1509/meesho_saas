import { ErrorResponseDto } from '../errors/error-response.dto';

/** Swagger pieces shared by the account-scoped domain controllers (orders, settlements, reconciliation). */
export const ACCOUNT_ID_PARAM = {
  name: 'accountId',
  description: 'Seller account id (positive integer, as a string)',
  example: '1',
};

export const ACCOUNT_NOT_FOUND_DOC = {
  type: ErrorResponseDto,
  description:
    'No such account, or the caller is not a member of its workspace',
};

export const LIST_BAD_REQUEST_DOC = {
  type: ErrorResponseDto,
  description: 'Invalid id, sort key, filter value or unknown parameter',
};
