-- CreateTable
CREATE TABLE "Touchpoint" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "wfId" TEXT NOT NULL,
    "influencerId" TEXT,
    "touchIndex" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Touchpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Touchpoint_storeId_sessionId_idx" ON "Touchpoint"("storeId", "sessionId");

-- CreateIndex
CREATE INDEX "Touchpoint_influencerId_idx" ON "Touchpoint"("influencerId");

-- CreateIndex
CREATE INDEX "Touchpoint_sessionId_touchIndex_idx" ON "Touchpoint"("sessionId", "touchIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Touchpoint_sessionId_wfId_key" ON "Touchpoint"("sessionId", "wfId");

-- AddForeignKey
ALTER TABLE "Touchpoint" ADD CONSTRAINT "Touchpoint_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Touchpoint" ADD CONSTRAINT "Touchpoint_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
