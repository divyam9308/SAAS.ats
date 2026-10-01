import { companyConfig } from '../config/companyConfig'

export const STORAGE_BUCKETS = {
  CV: companyConfig.documents.cvBucket,
  JD: companyConfig.documents.jdBucket,
  CONTRACT: companyConfig.documents.contractBucket,
  INVOICE: companyConfig.documents.invoiceBucket
}
