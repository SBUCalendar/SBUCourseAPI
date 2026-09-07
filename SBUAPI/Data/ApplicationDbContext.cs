using Microsoft.EntityFrameworkCore;
using SBUAPI.Models;

namespace SBUAPI.Data;

public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(
        DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    public DbSet<Course> Courses => Set<Course>();
    public DbSet<CourseMeeting> CourseMeetings => Set<CourseMeeting>();
    public DbSet<CourseProfessor> CourseProfessors => Set<CourseProfessor>();
    public DbSet<CourseExam> CourseExams => Set<CourseExam>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);


        modelBuilder.Entity<Course>(entity =>
        {
            entity.Property(x => x.TermCode)
                .HasMaxLength(20);

            entity.Property(x => x.CourseCode)
                .HasMaxLength(30);

            entity.Property(x => x.Group)
                .HasMaxLength(10);

            entity.Property(x => x.Name)
                .HasMaxLength(300);

            entity.Property(x => x.FacultyCode)
                .HasMaxLength(20);

            entity.Property(x => x.FacultyName)
                .HasMaxLength(200);

            entity.Property(x => x.DepartmentCode)
                .HasMaxLength(20);

            entity.Property(x => x.DepartmentName)
                .HasMaxLength(200);

            entity.Property(x => x.Gender)
                .HasMaxLength(30);

            entity.Property(x => x.OfferingMethod)
                .HasMaxLength(100);

            entity.Property(x => x.CoursePeriod)
                .HasMaxLength(200);

            entity.Property(x => x.IsActive)
                .HasDefaultValue(true);

            entity.HasIndex(x => new
            {
                x.TermCode,
                x.CourseCode,
                x.Group
            })
            .IsUnique();

            entity.HasIndex(x => new
            {
                x.TermCode,
                x.IsActive
            });

            entity.HasMany(x => x.Meetings)
                .WithOne(x => x.Course)
                .HasForeignKey(x => x.CourseId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(x => x.Professors)
                .WithOne(x => x.Course)
                .HasForeignKey(x => x.CourseId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Exam)
                .WithOne(x => x.Course)
                .HasForeignKey<CourseExam>(x => x.CourseId)
                .OnDelete(DeleteBehavior.Cascade);
        });


        modelBuilder.Entity<CourseMeeting>(entity =>
        {
            entity.Property(x => x.Type)
                .HasMaxLength(30);

            entity.Property(x => x.Day)
                .HasMaxLength(30);

            entity.Property(x => x.StartTime)
                .HasMaxLength(10);

            entity.Property(x => x.EndTime)
                .HasMaxLength(10);

            entity.HasIndex(x => x.Day);
        });


        modelBuilder.Entity<CourseProfessor>(entity =>
        {
            entity.Property(x => x.Name)
                .HasMaxLength(200);

            entity.HasIndex(x => x.Name);
        });


        modelBuilder.Entity<CourseExam>(entity =>
        {
            entity.Property(x => x.Date)
                .HasMaxLength(20);

            entity.Property(x => x.StartTime)
                .HasMaxLength(10);

            entity.Property(x => x.EndTime)
                .HasMaxLength(10);

            entity.HasIndex(x => x.Date);
        });

    }
}
