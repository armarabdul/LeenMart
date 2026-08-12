import type { Request, Response } from 'express';
import type {
  CreateKycUploadIntentRequest,
  CreateKycUploadIntentResponse,
  RegisterVendorResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { CreateKycUploadIntentUseCase } from '../../application/use-cases/create-kyc-upload-intent.use-case.js';
import type { RegisterVendorUseCase } from '../../application/use-cases/register-vendor.use-case.js';

export interface VendorController {
  readonly register: (req: Request, res: Response) => Promise<void>;
  readonly createKycUploadIntent: (req: Request, res: Response) => Promise<void>;
}

export interface VendorControllerDeps {
  readonly registerVendorUseCase: RegisterVendorUseCase;
  readonly createKycUploadIntentUseCase: CreateKycUploadIntentUseCase;
}

/**
 * Thin HTTP adapter: parses nothing itself (that is `validate()`'s job),
 * translates use-case output to the wire envelope, and never translates
 * errors — the global error handler owns that (SDD 17.1).
 */
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

    // Mapped field by field rather than spread: the use-case result and the
    // wire shape are allowed to diverge, and a spread would silently publish
    // whatever a future field is called.
    const data: CreateKycUploadIntentResponse = {
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
    };
    res.status(201).json({ data, meta: { requestId: getRequestId() } });
  },
});
