-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "budget" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Event_storeId_eventType_idx" ON "Event"("storeId", "eventType");

-- CreateIndex
CREATE INDEX "Event_influencerId_eventType_idx" ON "Event"("influencerId", "eventType");

-- CreateIndex
CREATE INDEX "Order_storeId_idx" ON "Order"("storeId");

-- CreateIndex
CREATE INDEX "Order_influencerId_idx" ON "Order"("influencerId");
