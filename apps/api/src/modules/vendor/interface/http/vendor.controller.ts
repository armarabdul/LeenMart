import type { Request, Response } from 'express';
import type {
  CreateKycUploadIntentRequest,
  CreateKycUploadIntentResponse,
  RegisterVendorResponse,
  SetVendorBusinessHoursRequest,
  SetVendorDeliverySlotsRequest,
  SetVendorPickupCapabilityRequest,
  SetVendorServiceablePincodesRequest,
  SetVendorShopAddressRequest,
  SetVendorShopNameRequest,
  SubmitVendorKycRequest,
  SubmitVendorKycResponse,
  VendorBusinessHoursResponse,
  VendorDeliverySlotsResponse,
  VendorPickupCapabilityResponse,
  VendorServiceablePincodesResponse,
  VendorShopAddressResponse,
  VendorShopProfileResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import type { CreateKycUploadIntentUseCase } from '../../application/use-cases/create-kyc-upload-intent.use-case.js';
import type { SetVendorPickupCapabilityUseCase } from '../../application/use-cases/set-vendor-pickup-capability.use-case.js';
import type { SetVendorShopAddressUseCase } from '../../application/use-cases/set-vendor-shop-address.use-case.js';
import type { SetVendorShopNameUseCase } from '../../application/use-cases/set-vendor-shop-name.use-case.js';
import type { GetVendorShopProfileUseCase } from '../../application/use-cases/get-vendor-shop-profile.use-case.js';
import type {
  GetVendorDeliverySlotsUseCase,
  SetVendorDeliverySlotsUseCase,
  VendorDeliverySlotsResult,
} from '../../application/use-cases/manage-vendor-delivery-slots.use-case.js';
import type {
  GetVendorBusinessHoursUseCase,
  SetVendorBusinessHoursUseCase,
  VendorBusinessHoursResult,
} from '../../application/use-cases/manage-vendor-business-hours.use-case.js';
import type {
  GetVendorServiceablePincodesUseCase,
  SetVendorServiceablePincodesUseCase,
  VendorServiceablePincodes,
} from '../../application/use-cases/manage-vendor-serviceable-pincodes.use-case.js';
import type { SubmitVendorKycUseCase } from '../../application/use-cases/submit-vendor-kyc.use-case.js';
import type { RegisterVendorUseCase } from '../../application/use-cases/register-vendor.use-case.js';

export interface VendorController {
  readonly register: (req: Request, res: Response) => Promise<void>;
  readonly createKycUploadIntent: (req: Request, res: Response) => Promise<void>;
  readonly submitKyc: (req: Request, res: Response) => Promise<void>;
  readonly setShopName: (req: Request, res: Response) => Promise<void>;
  readonly setPickupCapability: (req: Request, res: Response) => Promise<void>;
  readonly setShopAddress: (req: Request, res: Response) => Promise<void>;
  readonly getShopProfile: (req: Request, res: Response) => Promise<void>;
  readonly getServiceablePincodes: (req: Request, res: Response) => Promise<void>;
  readonly setServiceablePincodes: (req: Request, res: Response) => Promise<void>;
  readonly getBusinessHours: (req: Request, res: Response) => Promise<void>;
  readonly setBusinessHours: (req: Request, res: Response) => Promise<void>;
  readonly getDeliverySlots: (req: Request, res: Response) => Promise<void>;
  readonly setDeliverySlots: (req: Request, res: Response) => Promise<void>;
}

export interface VendorControllerDeps {
  readonly registerVendorUseCase: RegisterVendorUseCase;
  readonly createKycUploadIntentUseCase: CreateKycUploadIntentUseCase;
  readonly submitVendorKycUseCase: SubmitVendorKycUseCase;
  readonly setVendorShopNameUseCase: SetVendorShopNameUseCase;
  readonly setVendorPickupCapabilityUseCase: SetVendorPickupCapabilityUseCase;
  readonly setVendorShopAddressUseCase: SetVendorShopAddressUseCase;
  readonly getVendorShopProfileUseCase: GetVendorShopProfileUseCase;
  readonly getVendorServiceablePincodesUseCase: GetVendorServiceablePincodesUseCase;
  readonly setVendorServiceablePincodesUseCase: SetVendorServiceablePincodesUseCase;
  readonly getVendorBusinessHoursUseCase: GetVendorBusinessHoursUseCase;
  readonly setVendorBusinessHoursUseCase: SetVendorBusinessHoursUseCase;
  readonly getVendorDeliverySlotsUseCase: GetVendorDeliverySlotsUseCase;
  readonly setVendorDeliverySlotsUseCase: SetVendorDeliverySlotsUseCase;
}

const toShopProfileResponse = (vendor: VendorProfile): VendorShopProfileResponse => ({
  id: vendor.id,
  status: vendor.status.name,
  shopName: vendor.shopName,
});

/**
 * S4-ADDR. The shop-address surface returns the whole self-service profile —
 * name, pickup capability and address — because the vendor portal renders
 * them on one screen and a read that returned only the address would force a
 * second round trip for the rest.
 */
const toShopAddressResponse = (vendor: VendorProfile): VendorShopAddressResponse => ({
  id: vendor.id,
  status: vendor.status.name,
  shopName: vendor.shopName,
  supportsPickup: vendor.supportsPickup,
  shopAddress: vendor.shopAddress,
});

/** S4-SERV. `configured` is carried explicitly so an empty list is never mistaken for "delivers nowhere" (D7). */
const toServiceablePincodesResponse = (
  result: VendorServiceablePincodes,
): VendorServiceablePincodesResponse => ({
  id: result.vendorId,
  configured: result.configured,
  pincodes: [...result.pincodes],
});

/** S4-HOURS. `configured` is carried explicitly so an empty schedule is never mistaken for "never open" (H4-A). */
const toBusinessHoursResponse = (
  result: VendorBusinessHoursResult,
): VendorBusinessHoursResponse => ({
  id: result.vendorId,
  configured: result.configured,
  intervals: result.hours.intervals.map((interval) => ({ ...interval })),
  closures: result.hours.closures.map((closure) => ({
    weekday: closure.weekday,
    date: closure.closedOn,
  })),
});

/** S4-SLOTS. `configured` is carried explicitly so an empty offer is never mistaken for "never available". */
const toDeliverySlotsResponse = (
  result: VendorDeliverySlotsResult,
): VendorDeliverySlotsResponse => ({
  id: result.vendorId,
  configured: result.configured,
  slots: result.slots.map((slot) => ({ ...slot })),
  bookings: result.bookings.map((booking) => ({ ...booking })),
});

const toPickupCapabilityResponse = (vendor: VendorProfile): VendorPickupCapabilityResponse => ({
  id: vendor.id,
  status: vendor.status.name,
  supportsPickup: vendor.supportsPickup,
});

type IntentResult = Awaited<ReturnType<CreateKycUploadIntentUseCase['execute']>>;

/**
 * Mapped field by field rather than spread: the use-case result and the wire
 * shape are allowed to diverge, and a spread would silently publish whatever a
 * future field is called.
 */
const toUploadIntentResponse = (intent: IntentResult): CreateKycUploadIntentResponse => ({
  kycId: intent.kycId,
  expiresAt: intent.expiresAt.toISOString(),
  documents: intent.documents.map((document) => ({
    type: document.type as CreateKycUploadIntentResponse['documents'][number]['type'],
    objectKey: document.objectKey,
    uploadUrl: document.uploadUrl,
    contentType:
      document.contentType as CreateKycUploadIntentResponse['documents'][number]['contentType'],
    sizeBytes: document.sizeBytes,
    dataKey: document.dataKey,
    wrappedDataKey: document.wrappedDataKey,
  })),
});

/**
 * Thin HTTP adapter: parses nothing itself (that is `validate()`'s job),
 * translates use-case output to the wire envelope, and never translates
 * errors — the global error handler owns that (SDD 17.1).
 */
/** Split out of `createVendorController` to stay under this file's max-lines-per-function budget. */
const createSetShopNameHandler =
  (setVendorShopNameUseCase: SetVendorShopNameUseCase): VendorController['setShopName'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'PATCH /vendors/me/shop-profile reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const { body } = validatedData<SetVendorShopNameRequest>(req);
    const vendor = await setVendorShopNameUseCase.execute({
      principal: req.principal,
      shopName: body.shopName,
    });

    res
      .status(200)
      .json({ data: toShopProfileResponse(vendor), meta: { requestId: getRequestId() } });
  };

/** Mirrors `createSetShopNameHandler` — same "split out for the length budget" reasoning. */
const createSetPickupCapabilityHandler =
  (
    setVendorPickupCapabilityUseCase: SetVendorPickupCapabilityUseCase,
  ): VendorController['setPickupCapability'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'PATCH /vendors/me/pickup-capability reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const { body } = validatedData<SetVendorPickupCapabilityRequest>(req);
    const vendor = await setVendorPickupCapabilityUseCase.execute({
      principal: req.principal,
      supportsPickup: body.supportsPickup,
    });

    res
      .status(200)
      .json({ data: toPickupCapabilityResponse(vendor), meta: { requestId: getRequestId() } });
  };

/** Mirrors `createSetShopNameHandler` — same "split out for the length budget" reasoning. */
const createSetShopAddressHandler =
  (setVendorShopAddressUseCase: SetVendorShopAddressUseCase): VendorController['setShopAddress'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'PUT /vendors/me/shop-address reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const { body } = validatedData<SetVendorShopAddressRequest>(req);
    const vendor = await setVendorShopAddressUseCase.execute({
      principal: req.principal,
      shopAddress: {
        line1: body.line1,
        line2: body.line2,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
      },
    });

    res
      .status(200)
      .json({ data: toShopAddressResponse(vendor), meta: { requestId: getRequestId() } });
  };

/** The read half of the shop-address surface — see `GetVendorShopProfileUseCase`. */
const createGetShopProfileHandler =
  (getVendorShopProfileUseCase: GetVendorShopProfileUseCase): VendorController['getShopProfile'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /vendors/me/shop-address reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const vendor = await getVendorShopProfileUseCase.execute({ principal: req.principal });
    res
      .status(200)
      .json({ data: toShopAddressResponse(vendor), meta: { requestId: getRequestId() } });
  };

/** Mirrors `createSetShopAddressHandler` — same "split out for the length budget" reasoning. */
const createGetServiceablePincodesHandler =
  (
    getVendorServiceablePincodesUseCase: GetVendorServiceablePincodesUseCase,
  ): VendorController['getServiceablePincodes'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /vendors/me/serviceable-pincodes reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const result = await getVendorServiceablePincodesUseCase.execute({ principal: req.principal });
    res
      .status(200)
      .json({ data: toServiceablePincodesResponse(result), meta: { requestId: getRequestId() } });
  };

/** Mirrors `createSetShopAddressHandler` — same "split out for the length budget" reasoning. */
const createSetServiceablePincodesHandler =
  (
    setVendorServiceablePincodesUseCase: SetVendorServiceablePincodesUseCase,
  ): VendorController['setServiceablePincodes'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'PUT /vendors/me/serviceable-pincodes reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const { body } = validatedData<SetVendorServiceablePincodesRequest>(req);
    const result = await setVendorServiceablePincodesUseCase.execute({
      principal: req.principal,
      pincodes: body.pincodes,
    });

    res
      .status(200)
      .json({ data: toServiceablePincodesResponse(result), meta: { requestId: getRequestId() } });
  };

/** Mirrors `createSetShopAddressHandler` — same "split out for the length budget" reasoning. */
const createGetBusinessHoursHandler =
  (
    getVendorBusinessHoursUseCase: GetVendorBusinessHoursUseCase,
  ): VendorController['getBusinessHours'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /vendors/me/business-hours reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const result = await getVendorBusinessHoursUseCase.execute({ principal: req.principal });
    res
      .status(200)
      .json({ data: toBusinessHoursResponse(result), meta: { requestId: getRequestId() } });
  };

/**
 * The wire shape uses `date` for a dated closure; the domain calls it
 * `closedOn`. Mapped here rather than inline, so the handler stays inside the
 * function-length budget.
 */
const toDomainHours = (
  body: SetVendorBusinessHoursRequest,
): {
  intervals: { weekday: number; openMinute: number; closeMinute: number }[];
  closures: { weekday: number | null; closedOn: string | null }[];
} => ({
  intervals: body.intervals.map((interval) => ({ ...interval })),
  closures: body.closures.map((closure) => ({
    weekday: closure.weekday,
    closedOn: closure.date,
  })),
});

/** Mirrors `createSetShopAddressHandler` — same "split out for the length budget" reasoning. */
const createSetBusinessHoursHandler =
  (
    setVendorBusinessHoursUseCase: SetVendorBusinessHoursUseCase,
  ): VendorController['setBusinessHours'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'PUT /vendors/me/business-hours reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { body } = validatedData<SetVendorBusinessHoursRequest>(req);
    const result = await setVendorBusinessHoursUseCase.execute({
      principal: req.principal,
      hours: toDomainHours(body),
    });
    res
      .status(200)
      .json({ data: toBusinessHoursResponse(result), meta: { requestId: getRequestId() } });
  };

/** Split out alongside its siblings so `createVendorController` stays within the length budget. */
const createRegisterHandler =
  (registerVendorUseCase: RegisterVendorUseCase): VendorController['register'] =>
  async (req: Request, res: Response): Promise<void> => {
    // `authenticate()` guarantees `req.principal` is set before this handler
    // runs — reachability without it means the route was wired without the
    // middleware, a programming error, not a client-facing 401 case.
    if (!req.principal) {
      throw new Error(
        'POST /vendors reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const vendor = await registerVendorUseCase.execute({ principal: req.principal });
    const data: RegisterVendorResponse = { id: vendor.id, status: vendor.status.name };
    res.status(201).json({ data, meta: { requestId: getRequestId() } });
  };

/** Mirrors `createGetBusinessHoursHandler` — same "split out for the length budget" reasoning. */
const createGetDeliverySlotsHandler =
  (
    getVendorDeliverySlotsUseCase: GetVendorDeliverySlotsUseCase,
  ): VendorController['getDeliverySlots'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /vendors/me/delivery-slots reached without authenticate() middleware - req.principal is unset.',
      );
    }
    const result = await getVendorDeliverySlotsUseCase.execute({ principal: req.principal });
    res
      .status(200)
      .json({ data: toDeliverySlotsResponse(result), meta: { requestId: getRequestId() } });
  };

/** Mirrors `createSetBusinessHoursHandler` — same "split out for the length budget" reasoning. */
const createSetDeliverySlotsHandler =
  (
    setVendorDeliverySlotsUseCase: SetVendorDeliverySlotsUseCase,
  ): VendorController['setDeliverySlots'] =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'PUT /vendors/me/delivery-slots reached without authenticate() middleware - req.principal is unset.',
      );
    }
    const { body } = validatedData<SetVendorDeliverySlotsRequest>(req);
    const result = await setVendorDeliverySlotsUseCase.execute({
      principal: req.principal,
      slots: body.slots.map((slot) => ({ ...slot })),
    });
    res
      .status(200)
      .json({ data: toDeliverySlotsResponse(result), meta: { requestId: getRequestId() } });
  };

export const createVendorController = (deps: VendorControllerDeps): VendorController => ({
  register: createRegisterHandler(deps.registerVendorUseCase),

  createKycUploadIntent: async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /vendors/me/kyc/documents reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const { body } = validatedData<CreateKycUploadIntentRequest>(req);
    const intent = await deps.createKycUploadIntentUseCase.execute({
      principal: req.principal,
      documents: body.documents,
    });

    res
      .status(201)
      .json({ data: toUploadIntentResponse(intent), meta: { requestId: getRequestId() } });
  },

  submitKyc: async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /vendors/me/kyc reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const { body } = validatedData<SubmitVendorKycRequest>(req);
    const { kyc, vendor } = await deps.submitVendorKycUseCase.execute({
      principal: req.principal,
      kycId: body.kycId,
      pan: body.pan,
      gstin: body.gstin,
      bankAccount: body.bankAccount,
      documents: body.documents,
    });

    // Deliberately narrow. The aggregate holds fingerprints, masked tails and
    // wrapped keys; none of that belongs in a response, and mapping three
    // named fields is what stops a future field joining them by accident.
    const data: SubmitVendorKycResponse = {
      kycId: kyc.id,
      vendorStatus: vendor.status.name,
      submittedAt: kyc.submittedAt.toISOString(),
    };
    res.status(201).json({ data, meta: { requestId: getRequestId() } });
  },

  setShopName: createSetShopNameHandler(deps.setVendorShopNameUseCase),
  setPickupCapability: createSetPickupCapabilityHandler(deps.setVendorPickupCapabilityUseCase),
  setShopAddress: createSetShopAddressHandler(deps.setVendorShopAddressUseCase),
  getShopProfile: createGetShopProfileHandler(deps.getVendorShopProfileUseCase),
  getServiceablePincodes: createGetServiceablePincodesHandler(
    deps.getVendorServiceablePincodesUseCase,
  ),
  setServiceablePincodes: createSetServiceablePincodesHandler(
    deps.setVendorServiceablePincodesUseCase,
  ),
  getBusinessHours: createGetBusinessHoursHandler(deps.getVendorBusinessHoursUseCase),
  setBusinessHours: createSetBusinessHoursHandler(deps.setVendorBusinessHoursUseCase),
  getDeliverySlots: createGetDeliverySlotsHandler(deps.getVendorDeliverySlotsUseCase),
  setDeliverySlots: createSetDeliverySlotsHandler(deps.setVendorDeliverySlotsUseCase),
});
