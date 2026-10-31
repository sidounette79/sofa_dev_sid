import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Image } from "@/components/ui/image";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/text-field";
import { useDebounce } from "@/hooks/use-debounce";
import { getErrorMessage } from "@/lib/error-messages";
import { orpc } from "@/lib/orpc";
import { toast } from "@/lib/toast";

// 31.10, Sid ("j'ai des trucs complètement faux alors qu'ils sont juste
// dans sonarr et dans emby... comme le prisonnier, brothers et la loi et
// l'ordre... faut que je puisse aller chercher le truc juste sur tvdb ou
// tmdb") - same-named shows across decades can trip the automatic TMDB
// crossref. This lets her search TMDB directly and pick the right entry
// by hand instead of waiting on a server-side fix for each one.
export function RematchModal({
  titleId,
  open,
  onOpenChange,
}: {
  titleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const maxCardHeight = screenHeight - safeTop - safeBottom - 64;

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query.trim(), 300);

  const search = useQuery({
    ...orpc.admin.titleRematchSearch.queryOptions({
      input: { id: titleId, query: debouncedQuery },
    }),
    enabled: debouncedQuery.length > 0,
  });

  const rematch = useMutation(
    orpc.admin.titleRematch.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.titles.key() });
        toast.success(t`Title re-matched`);
        onOpenChange(false);
      },
      onError: (error: Error) => toast.error(getErrorMessage(error, t, t`Re-match failed`)),
    }),
  );

  const confirmAndRematch = (tmdbId: number, label: string) => {
    Alert.alert(t`Re-match this title?`, label, [
      { text: t`Cancel`, style: "cancel" },
      {
        text: t`Re-match`,
        style: "destructive",
        onPress: () => rematch.mutate({ id: titleId, tmdbId }),
      },
    ]);
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => onOpenChange(false)}
    >
      <Pressable
        className="flex-1 items-center justify-center bg-black/60"
        style={{ paddingTop: safeTop + 16, paddingBottom: safeBottom + 16 }}
        onPress={() => onOpenChange(false)}
      >
        <Pressable
          className="bg-card mx-6 w-full max-w-md overflow-hidden rounded-2xl"
          style={{ maxHeight: maxCardHeight }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="border-border/50 gap-3 border-b p-4">
            <Text className="text-foreground text-base font-medium">
              <Trans>Correct TMDB match</Trans>
            </Text>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder={t`Search by exact title and year...`}
              returnKeyType="search"
            />
          </View>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {debouncedQuery.length === 0 ? (
              <View className="items-center justify-center p-8">
                <Text className="text-muted-foreground text-sm">
                  <Trans>Type the title and year to narrow it down (e.g. "Brothers 2009")</Trans>
                </Text>
              </View>
            ) : search.isPending ? (
              <View className="items-center justify-center p-8">
                <Spinner colorClassName="accent-primary" />
              </View>
            ) : search.data?.results.length === 0 ? (
              <View className="items-center justify-center p-8">
                <Text className="text-muted-foreground text-sm">
                  <Trans>No results for "{debouncedQuery}"</Trans>
                </Text>
              </View>
            ) : (
              search.data?.results.map((candidate) => (
                <Pressable
                  key={candidate.tmdbId}
                  disabled={rematch.isPending}
                  className="active:bg-primary/5 flex-row items-center gap-3 px-4 py-3"
                  onPress={() =>
                    confirmAndRematch(
                      candidate.tmdbId,
                      `${candidate.title}${candidate.year ? ` (${candidate.year})` : ""}`,
                    )
                  }
                >
                  <View
                    className="bg-secondary overflow-hidden rounded-md"
                    style={{ width: 44, height: 66 }}
                  >
                    {candidate.posterUrl ? (
                      <Image
                        source={{ uri: candidate.posterUrl }}
                        recyclingKey={candidate.posterUrl}
                        className="h-full w-full"
                        contentFit="cover"
                      />
                    ) : null}
                  </View>
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-foreground text-base font-medium">
                      {candidate.title}
                    </Text>
                    {candidate.year && (
                      <Text className="text-muted-foreground text-xs">{candidate.year}</Text>
                    )}
                    {candidate.overview && (
                      <Text numberOfLines={2} className="text-muted-foreground mt-0.5 text-xs">
                        {candidate.overview}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
