-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "attributionSource" TEXT;

-- CreateTable
CREATE TABLE "LinkHub" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "destinations" JSONB NOT NULL DEFAULT '[]',
    "influencers" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubSession" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "linkHubId" TEXT NOT NULL,
    "selectedWfId" TEXT,
    "destination" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'abandoned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HubSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkHub_storeId_key" ON "LinkHub"("storeId");

-- CreateIndex
CREATE INDEX "HubSession_storeId_idx" ON "HubSession"("storeId");

-- CreateIndex
CREATE INDEX "HubSession_linkHubId_idx" ON "HubSession"("linkHubId");

-- AddForeignKey
ALTER TABLE "LinkHub" ADD CONSTRAINT "LinkHub_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubSession" ADD CONSTRAINT "HubSession_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubSession" ADD CONSTRAINT "HubSession_linkHubId_fkey" FOREIGN KEY ("linkHubId") REFERENCES "LinkHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
