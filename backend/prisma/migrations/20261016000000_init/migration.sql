-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VENDOR', 'LANDLORD', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "MeterStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'ZONE');

-- CreateEnum
CREATE TYPE "UnitParentType" AS ENUM ('ZONE', 'ROUTE', 'STREET');

-- CreateEnum
CREATE TYPE "TenantNodeType" AS ENUM ('ZONE', 'ROUTE', 'STREET', 'UNIT');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('STK', 'C2B', 'NCBA');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('CREDIT', 'CLEAR_TAMPER', 'CLEAR_CREDIT', 'SET_MAX_OVERDRAFT');

-- CreateEnum
CREATE TYPE "VendMode" AS ENUM ('UNIT', 'VALUE');

-- CreateEnum
CREATE TYPE "TokenOwnerType" AS ENUM ('VENDOR', 'LANDLORD', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('PENDING', 'REVIEWED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MpesaEnv" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "MpesaTransactionType" AS ENUM ('CUSTOMER_PAYBILL_ONLINE', 'CUSTOMER_BUYGOODS_ONLINE');

-- CreateEnum
CREATE TYPE "ConfigValueType" AS ENUM ('STRING', 'INTEGER', 'FLOAT', 'BOOLEAN', 'JSON');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('CUSTOMER_LOGIN', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "bio" TEXT,
    "profile_image" TEXT,
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "address" TEXT,
    "account_id" TEXT NOT NULL,
    "paybill" TEXT,
    "vendor_type" "VendorType" NOT NULL,
    "bank_name" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "logo_path" TEXT,
    "dashboard_settings" JSONB,
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landlords" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "payment_account" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "landlords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meters" (
    "id" TEXT NOT NULL,
    "meter_number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "initial_reading" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "price_per_unit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "MeterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sgc" INTEGER,
    "krn" INTEGER,
    "ti" INTEGER,
    "ea" INTEGER,
    "ken" INTEGER,
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "vendor_id" TEXT,
    "landlord_id" TEXT,

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "vendor_id" TEXT,
    "meter_id" TEXT,
    "county_id" INTEGER,
    "constituency_id" INTEGER,
    "ward_id" INTEGER,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counties" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "counties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "constituencies" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "county_id" INTEGER NOT NULL,

    CONSTRAINT "constituencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wards" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "county_id" INTEGER NOT NULL,
    "constituency_id" INTEGER NOT NULL,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mpesa_configs" (
    "id" TEXT NOT NULL,
    "consumer_key_enc" TEXT,
    "consumer_secret_enc" TEXT,
    "passkey_enc" TEXT,
    "shortcode" TEXT,
    "till_no" TEXT,
    "env" "MpesaEnv" NOT NULL DEFAULT 'SANDBOX',
    "callback_url" TEXT,
    "transaction_type" "MpesaTransactionType" NOT NULL DEFAULT 'CUSTOMER_BUYGOODS_ONLINE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "vendor_id" TEXT,
    "landlord_id" TEXT,

    CONSTRAINT "mpesa_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_configs" (
    "id" TEXT NOT NULL,
    "provider" TEXT,
    "api_url" TEXT,
    "api_key_enc" TEXT,
    "partner_id" TEXT,
    "shortcode" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "vendor_id" TEXT NOT NULL,

    CONSTRAINT "sms_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "type" "ConfigValueType" NOT NULL DEFAULT 'STRING',
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "vending_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "type" "ConfigValueType" NOT NULL DEFAULT 'INTEGER',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vending_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "merchant_request_id" TEXT,
    "checkout_request_id" TEXT,
    "account_reference" TEXT,
    "phone" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "mpesa_receipt_number" TEXT,
    "result_code" TEXT,
    "result_desc" TEXT,
    "payer_name" TEXT,
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_transactions" (
    "id" TEXT NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "token_type" "TokenType" NOT NULL DEFAULT 'CREDIT',
    "vend_mode" "VendMode",
    "owner_type" "TokenOwnerType",
    "amount" DECIMAL(12,2),
    "units" DECIMAL(14,3),
    "tokens" TEXT[],
    "control_index" INTEGER,
    "control_value" INTEGER,
    "external_transaction_id" TEXT,
    "transaction_time" TIMESTAMP(3),
    "send_sms" BOOLEAN NOT NULL DEFAULT false,
    "sms_sent" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "prism_message_id" TEXT,
    "description" TEXT,
    "meter_number_snapshot" TEXT,
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meter_id" TEXT,
    "vendor_id" TEXT,
    "landlord_id" TEXT,
    "customer_id" TEXT,
    "payment_id" TEXT,
    "actor_user_id" TEXT,

    CONSTRAINT "token_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "property_type" "PropertyType" NOT NULL,
    "no_of_units" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "map_url" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,

    CONSTRAINT "property_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_routes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,

    CONSTRAINT "property_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_streets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,

    CONSTRAINT "property_streets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit_number" TEXT,
    "parent_type" "UnitParentType" NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "zone_id" TEXT,
    "route_id" TEXT,
    "street_id" TEXT,
    "meter_id" TEXT,

    CONSTRAINT "property_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landlord_tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "node_type" "TenantNodeType" NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "zone_id" TEXT,
    "route_id" TEXT,
    "street_id" TEXT,
    "unit_id" TEXT,

    CONSTRAINT "landlord_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_enquiries" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "premises_type" TEXT NOT NULL,
    "residence_type" TEXT NOT NULL,
    "meter_types" TEXT[],
    "main_meter_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'PENDING',
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otps" (
    "id" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "identifier" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "summary" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_legacy_mongo_id_key" ON "users"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_account_id_key" ON "vendors"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_legacy_mongo_id_key" ON "vendors"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

-- CreateIndex
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- CreateIndex
CREATE UNIQUE INDEX "landlords_legacy_mongo_id_key" ON "landlords"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "landlords_user_id_key" ON "landlords"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "meters_meter_number_key" ON "meters"("meter_number");

-- CreateIndex
CREATE UNIQUE INDEX "meters_legacy_mongo_id_key" ON "meters"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "meters_vendor_id_idx" ON "meters"("vendor_id");

-- CreateIndex
CREATE INDEX "meters_landlord_id_idx" ON "meters"("landlord_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_legacy_mongo_id_key" ON "customers"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_vendor_id_idx" ON "customers"("vendor_id");

-- CreateIndex
CREATE INDEX "customers_meter_id_idx" ON "customers"("meter_id");

-- CreateIndex
CREATE INDEX "constituencies_county_id_idx" ON "constituencies"("county_id");

-- CreateIndex
CREATE INDEX "wards_constituency_id_idx" ON "wards"("constituency_id");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_configs_legacy_mongo_id_key" ON "mpesa_configs"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_configs_vendor_id_key" ON "mpesa_configs"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_configs_landlord_id_key" ON "mpesa_configs"("landlord_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_configs_legacy_mongo_id_key" ON "sms_configs"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_configs_vendor_id_key" ON "sms_configs"("vendor_id");

-- CreateIndex
CREATE INDEX "system_configs_category_idx" ON "system_configs"("category");

-- CreateIndex
CREATE UNIQUE INDEX "payments_checkout_request_id_key" ON "payments"("checkout_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_mpesa_receipt_number_key" ON "payments"("mpesa_receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_legacy_mongo_id_key" ON "payments"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "payments_account_reference_idx" ON "payments"("account_reference");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "token_transactions_legacy_mongo_id_key" ON "token_transactions"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "token_transactions_meter_id_created_at_idx" ON "token_transactions"("meter_id", "created_at");

-- CreateIndex
CREATE INDEX "token_transactions_vendor_id_created_at_idx" ON "token_transactions"("vendor_id", "created_at");

-- CreateIndex
CREATE INDEX "token_transactions_landlord_id_created_at_idx" ON "token_transactions"("landlord_id", "created_at");

-- CreateIndex
CREATE INDEX "token_transactions_payment_id_idx" ON "token_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "token_transactions_created_at_idx" ON "token_transactions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "properties_legacy_mongo_id_key" ON "properties"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "properties_landlord_id_idx" ON "properties"("landlord_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_zones_legacy_mongo_id_key" ON "property_zones"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "property_zones_property_id_idx" ON "property_zones"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_routes_legacy_mongo_id_key" ON "property_routes"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "property_routes_zone_id_idx" ON "property_routes"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_streets_legacy_mongo_id_key" ON "property_streets"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "property_streets_route_id_idx" ON "property_streets"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_units_legacy_mongo_id_key" ON "property_units"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_units_meter_id_key" ON "property_units"("meter_id");

-- CreateIndex
CREATE INDEX "property_units_property_id_idx" ON "property_units"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "landlord_tenants_legacy_mongo_id_key" ON "landlord_tenants"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "landlord_tenants_landlord_id_idx" ON "landlord_tenants"("landlord_id");

-- CreateIndex
CREATE INDEX "landlord_tenants_property_id_idx" ON "landlord_tenants"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_enquiries_legacy_mongo_id_key" ON "contact_enquiries"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "contact_enquiries_status_idx" ON "contact_enquiries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "otps_purpose_identifier_key" ON "otps"("purpose", "identifier");

-- CreateIndex
CREATE INDEX "audit_logs_subject_type_subject_id_idx" ON "audit_logs"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlords" ADD CONSTRAINT "landlords_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_constituency_id_fkey" FOREIGN KEY ("constituency_id") REFERENCES "constituencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constituencies" ADD CONSTRAINT "constituencies_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_constituency_id_fkey" FOREIGN KEY ("constituency_id") REFERENCES "constituencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_configs" ADD CONSTRAINT "mpesa_configs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_configs" ADD CONSTRAINT "mpesa_configs_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_zones" ADD CONSTRAINT "property_zones_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_zones" ADD CONSTRAINT "property_zones_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_routes" ADD CONSTRAINT "property_routes_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_routes" ADD CONSTRAINT "property_routes_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_routes" ADD CONSTRAINT "property_routes_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "property_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_streets" ADD CONSTRAINT "property_streets_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_streets" ADD CONSTRAINT "property_streets_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_streets" ADD CONSTRAINT "property_streets_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "property_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "property_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "property_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_street_id_fkey" FOREIGN KEY ("street_id") REFERENCES "property_streets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_tenants" ADD CONSTRAINT "landlord_tenants_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_tenants" ADD CONSTRAINT "landlord_tenants_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_tenants" ADD CONSTRAINT "landlord_tenants_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "property_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_tenants" ADD CONSTRAINT "landlord_tenants_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "property_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_tenants" ADD CONSTRAINT "landlord_tenants_street_id_fkey" FOREIGN KEY ("street_id") REFERENCES "property_streets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_tenants" ADD CONSTRAINT "landlord_tenants_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "property_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
