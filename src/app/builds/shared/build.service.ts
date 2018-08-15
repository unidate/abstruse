import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BuildStatus, Build } from './build.model';
import { getAPIURL, handleError } from '../../core/shared/shared-functions';
import { JSONResponse } from '../../core/shared/shared.model';
import { catchError } from 'rxjs/operators';
import { distanceInWordsToNow } from 'date-fns';

export interface ProviderData {
  name?: string;
  commitMessage?: string;
  committerAvatar?: string;
  authorAvatar?: string;
}

@Injectable({
  providedIn: 'root'
})
export class BuildService {
  builds: Build[] = [];
  fetchingBuilds: boolean;
  hideMoreButton: boolean;
  show: 'all' | 'pr' | 'commits';
  limit: number;
  offset: number;
  userId: number;

  constructor(public http: HttpClient) {
    this.resetFields();
  }

  fetchBuilds(): void {
    this.fetchingBuilds = true;
    const url = getAPIURL() + `/builds/limit/${this.limit}/offset/${this.offset}/${this.show}/${this.userId}`;

    this.http.get<JSONResponse>(url)
      .pipe(
        catchError(handleError<JSONResponse>('builds'))
      )
      .subscribe(resp => {
        if (resp && resp.data && resp.data.length) {
          Promise.resolve()
            .then(() => Promise.all<Build>(resp.data.map(build => this.generateBuild(build))))
            .then((builds: Build[]) => {
              this.builds = this.builds.concat(builds.sort((a, b) => b.id - a.id));
              this.fetchingBuilds = false;
              if (builds.length === this.limit) {
                this.offset += 5;
                this.hideMoreButton = false;
              } else {
                this.hideMoreButton = true;
              }
            });
        }
      });
  }

  resetFields(): void {
    this.fetchingBuilds = false;
    this.show = 'all';
    this.limit = 5;
    this.offset = 0;
    this.userId = 1;
  }

  private generateBuild(build: any): Promise<Build> {
    let status: BuildStatus = BuildStatus.queued;
    let maxCompletedJobTime: number;
    let minRunningJobStartTime: number;
    let buildTime: number = null;
    const currentTime = 0;
    let tag: string = null;
    let dateTime: string = null;
    let commitMessage: string = null;
    let committerAvatar: string = null;
    let authorAvatar: string = null;
    let id: number = build.id || null;
    let pr: number = null;
    let repo_name: string = null;
    let branch: string = null;
    let sha: string = null;

    return Promise.resolve()
      .then(() => {
        const data = build.data;

        if (build.jobs.findIndex(job => job.status === 'failed') !== -1) {
          status = BuildStatus.failed;
        }
        if (build.jobs.findIndex(job => job.status === 'running') !== -1) {
          status = BuildStatus.running;
        }
        if (build.jobs.length === build.jobs.filter(job => job.status === 'success').length) {
          status = BuildStatus.passed;
        }

        maxCompletedJobTime = Math.max(...build.jobs.map(job => job.end_time - job.start_time));
        minRunningJobStartTime = Math.min(...build.jobs.filter(job => job.status === 'running').map(job => job.start_time));

        if (status === BuildStatus.running && maxCompletedJobTime && minRunningJobStartTime) {
          if (maxCompletedJobTime > (currentTime - minRunningJobStartTime)) {
            buildTime = maxCompletedJobTime;
          } else if (maxCompletedJobTime <= (currentTime - minRunningJobStartTime)) {
            buildTime = currentTime - minRunningJobStartTime;
          }
        } else if (status !== BuildStatus.running) {
          buildTime = maxCompletedJobTime;
        }

        if (data.ref && data.ref.startsWith('refs/tags')) {
          tag = data.ref.replace('refs/tags', '');
        }

        if (build.pr) {
          pr = build.pr;
        }

        // repo name
        if (build.repository && build.repository.full_nmae) {
          repo_name = build.repository.full_name;
        } else {
          repo_name = data.repository.full_name;
        }

        // branch
        if (build.branch) {
          branch = build.branch;
        }

        // commit sha
        if (data && data.pull_request && data.pull_request.head && data.pull_request.head.sha) {
          sha = data.pull_request.head.sha;
        } else if (!data.pull_request && data.after) {
          sha = data.after;
        } else if (!data.pull_request && !data.after && data.sha) {
          sha = data.sha;
        } else if (!data.pull_request && !data.after && !data.sha && data.object_attributes && data.object_attributes.last_commit) {
          sha = data.object_attributes.last_commit.id;
        } else if (data.push && data.push.changes) {
          sha = data.push.changes[0].commits[0].hash;
        } else if (data.pullrequest) {
          sha = data.pullrequest.source.commit.hash;
        } else if (data.pull_request) {
          sha = data.pull_request.source.commit.hash;
        } else if (data.commit) {
          sha = data.commit.id;
        }

        if (!build.pr &&
          (data.object && data.object.kind && data.object_kind !== 'merge_request') &&
          (data.pull_request && !data.pull_request) && !tag
        ) {
          id = build.id;
        }

        dateTime = data.pull_request && data.pull_request.updated_at ||
          data.commit && data.commit.author && data.commit.author.date ||
          data.commits && data.commits[data.commits.length - 1] && data.commits[data.commits.length - 1].timestamp ||
          data.head_commit && data.head_commit.timestamp ||
          null;

        if (build.repository.repository_provider === 'github') {
          return this.extractGitHubData(data);
        } else if (build.repository.repository_provider === 'bitbucket') {
          if (data.actor) {
            authorAvatar = data.actor.links.avatar.href;
          }

          if (data.push) {
            commitMessage = data.push.changes[0].commits[0].message;
            dateTime = data.push.changes[0].commits[0].date;
            committerAvatar = data.push.changes[0].commits[0].author.user.links.avatar.href;
          } else if (data.pullrequest) {
            commitMessage = data.pullrequest.description;
            dateTime = data.pullrequest.updated_on;
            committerAvatar = data.pullrequest.author.links.avatar.href;
          }
        } else if (build.repository.repository_provider === 'gitlab') {
          // TODO
        } else if (build.repository.repository_provider === 'gogs') {
          // TODO
        }
      })
      .then(pdata => {
        return new Build(
          id,
          pr,
          repo_name,
          branch,
          sha,
          tag,
          pdata.name,
          pdata.authorAvatar,
          pdata.committerAvatar,
          pdata.commitMessage,
          buildTime,
          status
        );
      });
  }

  private extractGitHubData(data: any): Promise<ProviderData> {
    const providerData: ProviderData = {};
    return Promise.resolve()
      .then(() => {
        return new Promise((resolve, reject) => {
          if (data.commit) {
            providerData.commitMessage = data.commit.message;
          } else if (data.commits && data.commits.length) {
            const len = data.commits.length - 1;
            providerData.commitMessage = data.commits[len].message;
          } else if (data.pull_request && data.pull_request.title) { // TODO: change this!
            providerData.commitMessage = data.pull_request.title;
          } else if (data.head_commit) {
            providerData.commitMessage = data.head_commit.message;
          }

          if (data.sha) {
            providerData.committerAvatar = data.committer.avatar_url;
            providerData.name = data.commit.committer.name;
            providerData.authorAvatar = data.author.avatar_url;
          } else if (data.head_commit) {
            const commit = data.head_commit;
            providerData.committerAvatar = data.sender.avatar_url;
            providerData.name = commit.author.name;
            resolve();

            if (commit.author.username !== commit.comitter.username) {
              const url = `https://api.github.com/users/${commit.author.username}`;
              return this.customGet(url)
                .then(resp => providerData.authorAvatar = resp.avatar_url)
                .catch(err => resolve());
            } else {
              providerData.authorAvatar = providerData.committerAvatar;
              resolve();
            }
          } else if (data.pull_request) {
            providerData.authorAvatar = data.sender.avatar_url;
            providerData.committerAvatar = providerData.authorAvatar;

            const url = `https://api.github.com/users/${data.sender.login}`;
            return this.customGet(url)
              .then(resp => providerData.name = resp.name)
              .then(() => resolve())
              .catch(err => resolve());
          }
        });
      })
      .then(() => providerData);
  }

  private customGet(url: string): Promise<any> {
    return this.http.get(url)
      .pipe(
        catchError(handleError(url))
      )
      .toPromise();
  }
}
