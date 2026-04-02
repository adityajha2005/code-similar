import { NextResponse } from "next/server";
import { fetchGitHubRepository } from "@/lib/github";
import { sampleRepositories } from "@/lib/sample-data";
import { analyzeWithResava } from "@/lib/resava-analysis";
import { analyzeRepositories, filterRepositoryFiles } from "@/lib/similarity/engine";
import type { RepositoryInput, ScanRequest, SupportedLanguage } from "@/lib/types";

const supportedLanguages: SupportedLanguage[] = ["JavaScript", "TypeScript", "Python"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ScanRequest;
    const selectedLanguages = Array.isArray(body.languages)
      ? body.languages.filter((language): language is SupportedLanguage =>
          supportedLanguages.includes(language as SupportedLanguage),
        )
      : [];
    const repositories: RepositoryInput[] = [];
    const effectiveLanguages =
      selectedLanguages.length > 0 ? selectedLanguages : supportedLanguages;

    if (body.includeSeededRepos) {
      repositories.push(...filterRepositoryFiles(sampleRepositories, effectiveLanguages));
    }

    for (const url of body.repoUrls ?? []) {
      const repository = await fetchGitHubRepository(url, effectiveLanguages);
      if (repository) {
        repositories.push(repository);
      }
    }

    if (repositories.length === 0) {
      return NextResponse.json(
        {
          error: "No supported JavaScript, TypeScript, or Python files were found in the requested repositories.",
        },
        { status: 400 },
      );
    }

    if (body.engine === "resava") {
      const minPct = body.resavaMinSimilarity;
      const similarityPercent =
        typeof minPct === "number" && Number.isFinite(minPct)
          ? Math.min(100, Math.max(1, Math.round(minPct)))
          : 40;
      const preprocessor = body.resavaPreprocessor ?? "text";
      const result = await analyzeWithResava(repositories, {
        minSimilarityPercent: similarityPercent,
        preprocessor,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json(analyzeRepositories(repositories, body.method ?? "hybrid"));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected failure while scanning repositories.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
