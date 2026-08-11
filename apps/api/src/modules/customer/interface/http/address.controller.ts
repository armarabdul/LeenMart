import type { Request, Response } from 'express';
import type {
  AddAddressRequest,
  AddressResponse,
  ListAddressesResponse,
  RemoveAddressResponse,
  UpdateAddressRequest,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Address, AddressDetails } from '../../domain/entities/address.entity.js';
import { toAddressId } from '../../domain/value-objects/address-id.value-object.js';
import type { AddAddressUseCase } from '../../application/use-cases/add-address.use-case.js';
import type { ListAddressesUseCase } from '../../application/use-cases/list-addresses.use-case.js';
import type { UpdateAddressUseCase } from '../../application/use-cases/update-address.use-case.js';
import type { RemoveAddressUseCase } from '../../application/use-cases/remove-address.use-case.js';
import type { SetDefaultAddressUseCase } from '../../application/use-cases/set-default-address.use-case.js';

export interface AddressController {
  readonly add: (req: Request, res: Response) => Promise<void>;
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly update: (req: Request, res: Response) => Promise<void>;
  readonly remove: (req: Request, res: Response) => Promise<void>;
  readonly setDefault: (req: Request, res: Response) => Promise<void>;
}

export interface AddressControllerDeps {
  readonly addAddressUseCase: AddAddressUseCase;
  readonly listAddressesUseCase: ListAddressesUseCase;
  readonly updateAddressUseCase: UpdateAddressUseCase;
  readonly removeAddressUseCase: RemoveAddressUseCase;
  readonly setDefaultAddressUseCase: SetDefaultAddressUseCase;
}

const requirePrincipal = (req: Request, route: string): NonNullable<Request['principal']> => {
  // `authenticate()` guarantees `req.principal` is set before any handler
  // here runs — reachability without it means the route was wired without
  // the middleware, a programming error, not a client-facing 401 case.
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

const toAddressResponse = (address: Address): AddressResponse => ({
  id: address.id,
  recipientName: address.recipientName,
  phone: address.phone,
  line1: address.line1,
  line2: address.line2,
  city: address.city,
  state: address.state,
  pincode: address.pincode,
  landmark: address.landmark,
  label: address.label,
  isDefault: address.isDefault,
  createdAt: address.createdAt.toISOString(),
  updatedAt: address.updatedAt.toISOString(),
});

/** An empty string means "clear this optional field" — normalised to `null` here, once, rather than in every use case. */
const orNull = (value: string | undefined): string | null | undefined =>
  value === undefined ? undefined : value === '' ? null : value;

const DIRECT_FIELDS = [
  'recipientName',
  'phone',
  'line1',
  'city',
  'state',
  'pincode',
  'label',
] as const;
const CLEARABLE_FIELDS = ['line2', 'landmark'] as const;

/** Builds a PATCH body into a sparse update — only fields the client actually supplied are present. */
const toPartialDetails = (body: UpdateAddressRequest): Partial<AddressDetails> => {
  const details: Partial<Record<keyof AddressDetails, string | null>> = {};
  for (const field of DIRECT_FIELDS) {
    const value = body[field];
    if (value !== undefined) details[field] = value;
  }
  for (const field of CLEARABLE_FIELDS) {
    const value = body[field];
    if (value !== undefined) details[field] = orNull(value) ?? null;
  }
  return details as Partial<AddressDetails>;
};

/**
 * Thin HTTP adapter: parses nothing itself (that is `validate()`'s job),
 * translates use-case output to the wire envelope, and never translates
 * errors — the global error handler owns that (SDD 17.1).
 */
export const createAddressController = (deps: AddressControllerDeps): AddressController => ({
  add: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'POST /me/addresses');
    const { body } = validatedData<AddAddressRequest>(req);
    const address = await deps.addAddressUseCase.execute({
      principal,
      details: {
        recipientName: body.recipientName,
        phone: body.phone,
        line1: body.line1,
        line2: orNull(body.line2) ?? null,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
        landmark: orNull(body.landmark) ?? null,
        label: body.label,
      },
    });
    res.status(201).json({ data: toAddressResponse(address), meta: { requestId: getRequestId() } });
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'GET /me/addresses');
    const addresses = await deps.listAddressesUseCase.execute({ principal });
    const data: ListAddressesResponse = addresses.map(toAddressResponse);
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'PATCH /me/addresses/:id');
    const { body, params } = validatedData<UpdateAddressRequest, unknown, { id: string }>(req);
    const address = await deps.updateAddressUseCase.execute({
      principal,
      addressId: toAddressId(params.id),
      details: toPartialDetails(body),
    });
    res.status(200).json({ data: toAddressResponse(address), meta: { requestId: getRequestId() } });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'DELETE /me/addresses/:id');
    const { params } = validatedData<unknown, unknown, { id: string }>(req);
    await deps.removeAddressUseCase.execute({ principal, addressId: toAddressId(params.id) });
    const data: RemoveAddressResponse = { success: true };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },

  setDefault: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'POST /me/addresses/:id/default');
    const { params } = validatedData<unknown, unknown, { id: string }>(req);
    const address = await deps.setDefaultAddressUseCase.execute({
      principal,
      addressId: toAddressId(params.id),
    });
    res.status(200).json({ data: toAddressResponse(address), meta: { requestId: getRequestId() } });
  },
});
