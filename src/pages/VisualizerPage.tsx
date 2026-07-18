"use client";
import { useParams } from "react-router-dom";
import { MainLayout } from "@/components/main-layout";
import { DatabaseNavbar } from "@/components/database-navbar";
import SchemaVisualizer from "@/components/schema-visualizer";

export default function VisualizerPage() {
  const { connection: connectionId } = useParams<{ connection: string }>();

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        <DatabaseNavbar connectionId={connectionId || ""} />
        <div className="flex-1">
          {connectionId ? (
            <SchemaVisualizer connectionId={connectionId} />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a connection to view schema visualizer
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
