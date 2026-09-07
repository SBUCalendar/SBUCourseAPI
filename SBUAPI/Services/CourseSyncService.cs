using Microsoft.EntityFrameworkCore;
using SBUAPI.Data;
using SBUAPI.Models;
using Microsoft.AspNetCore.OutputCaching;

namespace SBUAPI.Services;

public sealed class CourseSyncService
{
    private readonly BehestanClient _behestanClient;
    private readonly CourseParser _courseParser;
    private readonly ApplicationDbContext _db;
    private readonly IOutputCacheStore _outputCacheStore;
    private readonly ILogger<CourseSyncService> _logger;

    public CourseSyncService(
        BehestanClient behestanClient,
        CourseParser courseParser,
        ApplicationDbContext db,
        IOutputCacheStore outputCacheStore,
        ILogger<CourseSyncService> logger)
    {
        _behestanClient = behestanClient;
        _courseParser = courseParser;
        _db = db;
        _outputCacheStore = outputCacheStore;
        _logger = logger;
    }

    public async Task<CourseSyncResult> SyncAsync(
        BehestanSessionInput session,
        CancellationToken cancellationToken = default)
    {

        var fetchResult = await _behestanClient.FetchCoursesAsync(
            session,
            cancellationToken
        );

        if (!fetchResult.Success)
        {
            return new CourseSyncResult(
                false,
                0,
                fetchResult.Error ??
                $"Behestan ret={fetchResult.Ret}"
            );
        }

        if (string.IsNullOrWhiteSpace(fetchResult.BMt))
        {
            return new CourseSyncResult(
                false,
                0,
                "BMt خالی بود. دیتابیس تغییر نکرد."
            );
        }


        List<Course> incomingCourses;

        try
        {
            incomingCourses =
                _courseParser.Parse(fetchResult.BMt);
        }
        catch (Exception ex)
        {
            return new CourseSyncResult(
                false,
                0,
                $"خطا در Parse اطلاعات: {ex.Message}"
            );
        }

        if (incomingCourses.Count == 0)
        {
            return new CourseSyncResult(
                false,
                0,
                "هیچ درسی Parse نشد. دیتابیس تغییر نکرد."
            );
        }


        const string termCode = "4051";

        foreach (var course in incomingCourses)
        {
            course.TermCode = termCode;
        }


        var duplicate = incomingCourses
            .GroupBy(CreateKey)
            .FirstOrDefault(g => g.Count() > 1);

        if (duplicate is not null)
        {
            return new CourseSyncResult(
                false,
                0,
                $"درس تکراری در گزارش دریافت شد: " +
                $"{duplicate.Key.CourseCode}_" +
                $"{duplicate.Key.Group}"
            );
        }


        var currentActiveCount = await _db.Courses
            .AsNoTracking()
            .CountAsync(
                c => c.TermCode == termCode &&
                     c.IsActive,
                cancellationToken
            );

        if (currentActiveCount > 0)
        {
            var minimumSafeCount =
                (int)Math.Floor(currentActiveCount * 0.70);

            if (incomingCourses.Count < minimumSafeCount)
            {
                return new CourseSyncResult(
                    false,
                    0,
                    $"Sync لغو شد. تعداد دروس جدید " +
                    $"{incomingCourses.Count} است، در حالی که " +
                    $"{currentActiveCount} درس فعال در دیتابیس وجود دارد. " +
                    $"احتمالاً گزارش ناقص یا فیلتر شده است."
                );
            }
        }


        await using var transaction =
            await _db.Database.BeginTransactionAsync(
                cancellationToken
            );

        try
        {
            var now = DateTimeOffset.UtcNow;


            var existingCourses = await _db.Courses
                .Where(c => c.TermCode == termCode)
                .Include(c => c.Meetings)
                .Include(c => c.Professors)
                .Include(c => c.Exam)
                .AsSplitQuery()
                .ToListAsync(cancellationToken);

            var existingByKey = existingCourses
                .ToDictionary(CreateKey);

            var incomingKeys = incomingCourses
                .Select(CreateKey)
                .ToHashSet();

            var addedCount = 0;
            var existingCount = 0;
            var deactivatedCount = 0;


            foreach (var incoming in incomingCourses)
            {
                var key = CreateKey(incoming);

                if (!existingByKey.TryGetValue(
                        key,
                        out var existing))
                {
                    continue;
                }

                if (existing.Meetings.Count > 0)
                {
                    _db.CourseMeetings.RemoveRange(
                        existing.Meetings
                    );
                }

                if (existing.Professors.Count > 0)
                {
                    _db.CourseProfessors.RemoveRange(
                        existing.Professors
                    );
                }

                if (existing.Exam is not null)
                {
                    _db.CourseExams.Remove(existing.Exam);
                }
            }


            await _db.SaveChangesAsync(cancellationToken);


            foreach (var incoming in incomingCourses)
            {
                var key = CreateKey(incoming);


                if (existingByKey.TryGetValue(
                        key,
                        out var existing))
                {
                    existingCount++;

                    UpdateCourse(
                        existing,
                        incoming,
                        now
                    );

                    existing.Meetings.Clear();
                    existing.Professors.Clear();
                    existing.Exam = null;

                    foreach (var meeting in incoming.Meetings)
                    {
                        existing.Meetings.Add(
                            new CourseMeeting
                            {
                                Type = meeting.Type,
                                Day = meeting.Day,
                                StartTime = meeting.StartTime,
                                EndTime = meeting.EndTime
                            }
                        );
                    }

                    foreach (var professor
                             in incoming.Professors)
                    {
                        existing.Professors.Add(
                            new CourseProfessor
                            {
                                Name = professor.Name
                            }
                        );
                    }

                    if (incoming.Exam is not null)
                    {
                        existing.Exam = new CourseExam
                        {
                            Date = incoming.Exam.Date,
                            StartTime =
                                incoming.Exam.StartTime,
                            EndTime =
                                incoming.Exam.EndTime
                        };
                    }

                    continue;
                }


                incoming.IsActive = true;
                incoming.LastSeenAtUtc = now;

                await _db.Courses.AddAsync(
                    incoming,
                    cancellationToken
                );

                addedCount++;
            }


            foreach (var existing in existingCourses)
            {
                var key = CreateKey(existing);

                if (incomingKeys.Contains(key))
                    continue;

                if (!existing.IsActive)
                    continue;

                existing.IsActive = false;
                deactivatedCount++;
            }


            await _db.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(
                cancellationToken
            );

            try
            {
                await _outputCacheStore.EvictByTagAsync(
                    "courses",
                    CancellationToken.None
                );
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Course output cache could not be invalidated after sync."
                );
            }

            return new CourseSyncResult(
                true,
                incomingCourses.Count,
                $"Sync موفق بود. " +
                $"{incomingCourses.Count} درس دریافت شد؛ " +
                $"{addedCount} درس جدید، " +
                $"{existingCount} درس موجود، " +
                $"{deactivatedCount} درس غیرفعال شد."
            );
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(
                cancellationToken
            );

            return new CourseSyncResult(
                false,
                0,
                $"خطا هنگام Sync دیتابیس: {ex.Message}"
            );
        }
    }


    private static CourseKey CreateKey(Course course)
    {
        return new CourseKey(
            course.TermCode.Trim(),
            course.CourseCode.Trim(),
            course.Group.Trim()
        );
    }


    private static void UpdateCourse(
        Course target,
        Course source,
        DateTimeOffset now)
    {
        target.Name = source.Name;

        target.Units = source.Units;
        target.PracticalUnits =
            source.PracticalUnits;

        target.FacultyCode =
            source.FacultyCode;

        target.FacultyName =
            source.FacultyName;

        target.DepartmentCode =
            source.DepartmentCode;

        target.DepartmentName =
            source.DepartmentName;

        target.Capacity =
            source.Capacity;

        target.Registered =
            source.Registered;

        target.Waitlist =
            source.Waitlist;

        target.Gender =
            source.Gender;

        target.Restrictions =
            source.Restrictions;

        target.EntryRestriction =
            source.EntryRestriction;

        target.ConflictingCourses =
            source.ConflictingCourses;

        target.OfferingMethod =
            source.OfferingMethod;

        target.CoursePeriod =
            source.CoursePeriod;

        target.Notes =
            source.Notes;

        target.RawSchedule =
            source.RawSchedule;

        target.RawExam =
            source.RawExam;

        target.IsActive = true;
        target.LastSeenAtUtc = now;
    }

    private readonly record struct CourseKey(
        string TermCode,
        string CourseCode,
        string Group
    );
}

public sealed record CourseSyncResult(
    bool Success,
    int CourseCount,
    string Message
);
