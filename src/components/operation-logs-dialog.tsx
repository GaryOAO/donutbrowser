import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuRefreshCw } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BrowserProfile } from "@/types";

type LogEntry = {
  timestamp: string;
  profile_id?: string;
  proxy_group?: string;
  proxy_node?: string;
  action: string;
  result: string;
  latency_ms: number;
  message?: string;
};

export function OperationLogsDialog({
  open,
  onOpenChange,
  profiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: BrowserProfile[];
}) {
  const { t } = useTranslation();
  const [profileId, setProfileId] = useState("all");
  const [startTime, setStartTime] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const load = useCallback(async () => {
    const data = await invoke<LogEntry[]>("get_recent_operation_logs", {
      filter: {
        profile_id: profileId === "all" ? null : profileId,
        start_time: startTime || null,
      },
    });
    setLogs(data);
  }, [profileId, startTime]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("operationLogs.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="space-y-2">
            <Label>{t("operationLogs.profileFilter")}</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("operationLogs.allProfiles")}
                </SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="operation-log-start">
              {t("operationLogs.timeFilter")}
            </Label>
            <Input
              id="operation-log-start"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="2026-05-07T09:00:00Z"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => void load()}
            >
              <LuRefreshCw className="mr-2 h-4 w-4" />
              {t("operationLogs.refresh")}
            </Button>
          </div>
        </div>
        <ScrollArea className="h-96 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("operationLogs.time")}</TableHead>
                <TableHead>{t("operationLogs.profile")}</TableHead>
                <TableHead>{t("operationLogs.action")}</TableHead>
                <TableHead>{t("operationLogs.result")}</TableHead>
                <TableHead className="text-right">
                  {t("operationLogs.latency")}
                </TableHead>
                <TableHead>{t("operationLogs.message")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {t("operationLogs.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log, index) => (
                  <TableRow key={`${log.timestamp}-${index}`}>
                    <TableCell>
                      {new Date(log.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">
                      {profiles.find((profile) => profile.id === log.profile_id)
                        ?.name ??
                        log.profile_id ??
                        "-"}
                    </TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          log.result === "failed" ? "destructive" : "outline"
                        }
                      >
                        {log.result}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {log.latency_ms}ms
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">
                      {log.message ?? "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
