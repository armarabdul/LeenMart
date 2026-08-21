import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { UpdateProductRequest } from '@leen-mart/contracts';
import { Alert, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  useDeleteProductMutation,
  useGetProductQuery,
  useSubmitProductMutation,
  useUpdateProductMutation,
} from '@/features/vendor-product/vendor-product.api';
import { ProductDetailsForm } from '@/features/vendor-product/components/ProductDetailsForm';
import { VariantsSection } from '@/features/vendor-product/components/VariantsSection';
import { MediaSection } from '@/features/vendor-product/components/MediaSection';
import { ProductActions } from '@/features/vendor-product/components/ProductActions';
import { PRODUCT_STATUS_LABEL } from '@/features/vendor-product/lib/product-status-label';
import { PRODUCT_STATUS_TONE } from '@/features/vendor-product/lib/product-status-tone';
import { flattenCategoryTree } from '@/features/vendor-product/lib/flatten-category-tree';
import { useGetCategoryTreeQuery } from '@/features/catalogue/catalogue.api';

const EditSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading product">
    {Array.from({ length: 4 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/** One product, in full (S2-3/S2-3a/S2-4/S2-5/S2-6a, Phase J) — details, variants, stock and photos. */
export const VendorProductEditPage = (): JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: product, isLoading, isError, error } = useGetProductQuery(id ?? '', { skip: !id });
  const { data: categories, isLoading: isCategoriesLoading } = useGetCategoryTreeQuery();
  const [updateProduct, { isLoading: isSavingDetails, error: saveError }] =
    useUpdateProductMutation();
  const [submitProduct, { isLoading: isSubmittingForReview, error: submitError }] =
    useSubmitProductMutation();
  const [deleteProduct, { isLoading: isDeleting, error: deleteError }] = useDeleteProductMutation();
  const [justSaved, setJustSaved] = useState(false);

  const handleSaveDetails = async (body: UpdateProductRequest): Promise<void> => {
    if (!id) return;
    setJustSaved(false);
    try {
      await updateProduct({ productId: id, body }).unwrap();
      setJustSaved(true);
    } catch {
      // Surfaced via `saveError` inside `ProductDetailsForm`.
    }
  };

  const handleSubmitForReview = async (): Promise<void> => {
    if (!id) return;
    try {
      await submitProduct(id).unwrap();
    } catch {
      // Surfaced below via `submitError`.
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!id) return;
    try {
      await deleteProduct(id).unwrap();
      void navigate('/products', { replace: true });
    } catch {
      // Surfaced below via `deleteError`.
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Edit product</h1>
        <EditSkeleton />
      </main>
    );
  }

  if (isError || !product || !id) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Edit product</h1>
        <Alert tone="danger">{apiErrorMessage(error, 'This product could not be found.')}</Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Edit product</h1>
        <StatusBadge
          tone={PRODUCT_STATUS_TONE[product.status]}
          label={PRODUCT_STATUS_LABEL[product.status]}
        />
      </div>

      <ProductDetailsForm
        product={product}
        categoryOptions={flattenCategoryTree(categories ?? [])}
        isCategoriesLoading={isCategoriesLoading}
        onSave={handleSaveDetails}
        isSaving={isSavingDetails}
        saveError={saveError}
        justSaved={justSaved}
      />

      <VariantsSection productId={id} />

      <MediaSection productId={id} />

      <ProductActions
        status={product.status}
        isSubmittingForReview={isSubmittingForReview}
        submitError={submitError}
        onSubmitForReview={() => void handleSubmitForReview()}
        isDeleting={isDeleting}
        deleteError={deleteError}
        onDelete={() => void handleDelete()}
      />
    </main>
  );
};
