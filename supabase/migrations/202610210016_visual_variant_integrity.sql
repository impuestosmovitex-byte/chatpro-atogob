-- STAGING: guarantee that an uploaded image belongs to the exact selected variant and product.
create unique index if not exists commerce_variant_company_product_triplet
  on public.commerce_variants(company_id,id,product_id);
alter table public.commerce_product_images
  add constraint commerce_image_valid_variant_product
    foreign key(company_id,variant_id,product_id)
    references public.commerce_variants(company_id,id,product_id) on delete cascade;
