-- Add appEmbedEnabled flag to Store
-- Tracks whether merchant has enabled the Winfluencer App Embed Block in their theme
ALTER TABLE "Store" ADD COLUMN "appEmbedEnabled" BOOLEAN NOT NULL DEFAULT false;
