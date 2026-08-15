import type { Request, Response } from 'express';
import type {
  CreateKycUploadIntentRequest,
  CreateKycUploadIntentResponse,
  RegisterVendorResponse,
  SetVendorShopNameRequest,
  SubmitVendorKycRequest,
  SubmitVendorKycResponse,
  VendorShopProfileResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import type { CreateKycUploadIntentUseCase } from '../../application/use-cases/create-kyc-upload-intent.use-case.js';
import type { SetVendorShopNameUseCase } from '../../application/use-cases/set-vendor-shop-name.use-case.js';
import type { SubmitVendorKycUseCase } from '../../application/use-cases/submit-vendor-kyc.use-case.js';
import type { RegisterVendorUseCase } from '../../application/use-cases/register-vendor.use-case.js';

export interface VendorController {
  readonly register: (req: Request, res: Response) => Promise<void>;
  readonly createKycUploadIntent: (req: Request, res: Response) => Promise<void>;
  readonly submitKyc: (req: Request, res: Response) => Promise<void>;
  readonly setShopName: (req: Request, res: Response) => Promise<void>;
}

export interface VendorControllerDeps {
  readonly registerVendorUseCase: RegisterVendorUseCase;
  readonly createKycUploadIntentUseCase: CreateKycUploadIntentUseCase;
  readonly submitVendorKycUseCase: SubmitVendorKycUseCase;
  readonly setVendorShopNameUseCase: SetVendorShopNameUseCase;
}

const toShopProfileResponse = (vendor: VendorProfile): VendorShopProfileResponse => ({
  id: vendor.id,
  status: vendor.status.name,
  shopName: vendor.shopName,
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

export const createVendorController = (deps: VendorControllerDeps): VendorController => ({
  register: async (req: Request, res: Response): Promise<void> => {
    // `authenticate()` guarantees `req.principal` is set before this handler
    // runs — reachability without it means the route was wired without the
    // middleware, a programming error, not a client-facing 401 case.
    if (!req.principal) {
      throw new Error(
        'POST /vendors reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const vendor = await deps.registerVendorUseCase.execute({ principal: req.principal });
    const data: RegisterVendorResponse = { id: vendor.id, status: vendor.status.name };
    res.status(201).json({ data, meta: { requestId: getRequestId() } });
  },

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
});
