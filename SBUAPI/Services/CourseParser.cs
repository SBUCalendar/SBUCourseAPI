using System.Net;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using SBUAPI.Models;

namespace SBUAPI.Services;

public sealed class CourseParser
{
    private static readonly Regex MeetingRegex = new(
        @"(?<type>درس\s*\([^)]+\))\s*[:：]\s*" +
        @"(?<day>.+?)\s+" +
        @"(?<start>\d{1,2}:\d{2})\s*[-–—]\s*" +
        @"(?<end>\d{1,2}:\d{2})",
        RegexOptions.CultureInvariant
    );

    public List<Course> Parse(string bmt)
    {
        if (string.IsNullOrWhiteSpace(bmt))
            return [];

        var document = XDocument.Parse(bmt);

        return document.Root?
            .Elements("row")
            .Select(ParseRow)
            .ToList() ?? [];
    }

    private static Course ParseRow(XElement row)
    {

        var numberAndGroup = Get(row, "C1");

        var (courseCode, group) = ParseCourseNumber(numberAndGroup);

        var rawSchedule = Get(row, "C12");
        var rawExam = Get(row, "C13");

        return new Course
        {
            FacultyCode = Get(row, "B1"),
            FacultyName = Get(row, "B2"),

            DepartmentCode = Get(row, "B3"),
            DepartmentName = Get(row, "B4"),

            CourseCode = courseCode,
            Group = group,
            Name = Get(row, "C2"),

            Units = ParseHtmlNumber(Get(row, "C3")),
            PracticalUnits = ParseHtmlNumber(Get(row, "C4")),

            Capacity = ParseInt(Get(row, "C7")),
            Registered = ParseInt(Get(row, "C8")),
            Waitlist = ParseInt(Get(row, "C9")),

            Gender = Get(row, "C10"),

            Professors = ParseProfessors(Get(row, "C11")).Select(name => new CourseProfessor
            {
                Name = name
            })
            .ToList(),

            RawSchedule = rawSchedule,
            Meetings = ParseMeetings(rawSchedule),

            RawExam = rawExam,
            Exam = ParseExam(rawExam),

            Restrictions = CleanHtml(Get(row, "C15")),
            EntryRestriction = CleanHtml(Get(row, "C16")),
            ConflictingCourses = CleanHtml(Get(row, "C17")),
            OfferingMethod = CleanHtml(Get(row, "C18")),
            CoursePeriod = CleanHtml(Get(row, "C19")),
            Notes = CleanHtml(Get(row, "C25"))
        };
    }

    private static string Get(XElement row, string attribute)
    {
        return PersianTextNormalizer.Normalize(
            row.Attribute(attribute)?.Value
        );
    }

    private static (string CourseCode, string Group) ParseCourseNumber(
        string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return ("", "");

        var parts = value.Split(
            '_',
            2,
            StringSplitOptions.TrimEntries
        );

        return parts.Length == 2
            ? (parts[0], parts[1])
            : (value, "");
    }

    private static int ParseHtmlNumber(string value)
    {
        var clean = CleanHtml(value);

        return int.TryParse(clean, out var number)
            ? number
            : 0;
    }

    private static int ParseInt(string value)
    {
        return int.TryParse(value, out var number)
            ? number
            : 0;
    }

    private static string CleanHtml(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "";

        var decoded = WebUtility.HtmlDecode(value);

        decoded = Regex.Replace(
            decoded,
            @"(?i)<br\s*/?>",
            "\n"
        );

        decoded = Regex.Replace(
            decoded,
            "<.*?>",
            ""
        );

        return PersianTextNormalizer.Normalize(decoded);
    }

    private static List<string> ParseProfessors(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return [];

        var decoded = WebUtility.HtmlDecode(value);

        return Regex.Split(
                decoded,
                @"(?i)<br\s*/?>"
            )
            .Select(x => CleanHtml(x))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct()
            .ToList();
    }

    private static List<CourseMeeting> ParseMeetings(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return [];

        var result = new List<CourseMeeting>();

        var schedule = CleanHtml(value);

        foreach (Match match in MeetingRegex.Matches(schedule))
        {
            result.Add(new CourseMeeting
            {
                Type = match.Groups["type"].Value.Trim(),
                Day = NormalizeWhitespace(
                    match.Groups["day"].Value
                ),
                StartTime = match.Groups["start"].Value,
                EndTime = match.Groups["end"].Value
            });
        }

        return result;
    }

    private static CourseExam? ParseExam(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var decoded = CleanHtml(value);

        var dateMatch = Regex.Match(
            decoded,
            @"\d{4}/\d{2}/\d{2}"
        );

        var timeMatch = Regex.Match(
            decoded,
            @"(?<start>\d{1,2}:\d{2})-" +
            @"(?<end>\d{1,2}:\d{2})"
        );

        if (!dateMatch.Success && !timeMatch.Success)
            return null;

        return new CourseExam
        {
            Date = dateMatch.Success
                ? dateMatch.Value
                : "",

            StartTime = timeMatch.Success
                ? timeMatch.Groups["start"].Value
                : "",

            EndTime = timeMatch.Success
                ? timeMatch.Groups["end"].Value
                : ""
        };
    }

    private static string NormalizeWhitespace(string value)
    {
        return Regex.Replace(value.Trim(), @"\s+", " ");
    }
}
