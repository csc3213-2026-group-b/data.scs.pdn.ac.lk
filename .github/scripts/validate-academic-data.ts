import {
  AcademicYearSchema,
  CourseCodeSchema
} from '@csc3213-2026-group-b/academic-domain-schemas';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

type JsonRecord = Record<string, unknown>;

interface ValidationResult {
  errors: string[];
  warnings: string[];
  counts: {
    courses: number;
    offerings: number;
  };
}

export interface AcademicRegistry {
  courses: Map<string, JsonRecord>;
  offerings: Map<string, JsonRecord>;
}

const idSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const courseSchema = z
  .object({
    id: idSchema,
    primaryCode: CourseCodeSchema,
    codes: z.array(CourseCodeSchema).min(1),
    title: z.string().trim().min(1),
    credits: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6)])
  })
  .refine((course) => course.codes.includes(course.primaryCode), {
    message: 'primaryCode must be listed in codes',
    path: ['primaryCode']
  })
  .refine((course) => new Set(course.codes).size === course.codes.length, {
    message: 'codes must not contain duplicates',
    path: ['codes']
  });

const courseStaffSchema = z.object({
  staff: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9._-]+$/i),
  role: z.enum([
    'COURSE_COORDINATOR',
    'LECTURER',
    'INSTRUCTOR',
    'TEACHING_ASSISTANT'
  ])
});

const offeringSchema = z.object({
  id: idSchema,
  courseId: idSchema,
  academicYear: AcademicYearSchema,
  semester: z.enum(['SEM1', 'SEM2']),
  staff: z.array(courseStaffSchema)
});

function toPosix(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}

async function readJson(root: string, relativePath: string) {
  const absolutePath = path.join(root, relativePath);
  const content = await readFile(absolutePath, 'utf8');
  return JSON.parse(content) as unknown;
}

async function listJsonFiles(root: string, relativeDir: string) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];

  const entries = await readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => toPosix(path.join(relativeDir, entry.name)))
    .sort();
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function validateRecord<T>(
  result: ValidationResult,
  relativePath: string,
  value: unknown,
  schema: z.ZodType<T>
) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  for (const issue of parsed.error.issues) {
    const issuePath = issue.path.length ? `.${issue.path.join('.')}` : '';
    result.errors.push(`${relativePath}${issuePath}: ${issue.message}`);
  }
  return null;
}

export async function loadAcademicRegistry(
  root = process.cwd(),
  result?: Pick<ValidationResult, 'errors'>
): Promise<AcademicRegistry> {
  const coursesPath = 'public/academic/v1/courses.json';
  const offeringsPath = 'public/academic/v1/offerings.json';
  const coursesValue = existsSync(path.join(root, coursesPath))
    ? await readJson(root, coursesPath)
    : [];
  const offeringsValue = existsSync(path.join(root, offeringsPath))
    ? await readJson(root, offeringsPath)
    : [];

  const courses = new Map<string, JsonRecord>();
  const offerings = new Map<string, JsonRecord>();

  if (!Array.isArray(coursesValue)) {
    result?.errors.push(`${coursesPath}: expected a JSON array`);
  } else {
    for (const [index, value] of coursesValue.entries()) {
      const course = courseSchema.safeParse(value);
      if (course.success) {
        courses.set(course.data.id, course.data);
      } else {
        result?.errors.push(`${coursesPath}[${index}]: invalid course record`);
      }
    }
  }

  if (!Array.isArray(offeringsValue)) {
    result?.errors.push(`${offeringsPath}: expected a JSON array`);
  } else {
    for (const [index, value] of offeringsValue.entries()) {
      const offering = offeringSchema.safeParse(value);
      if (offering.success) {
        offerings.set(offering.data.id, offering.data);
      } else {
        result?.errors.push(
          `${offeringsPath}[${index}]: invalid course offering record`
        );
      }
    }
  }

  return { courses, offerings };
}

export async function validateAcademicData(
  root = process.cwd()
): Promise<ValidationResult> {
  const result: ValidationResult = {
    errors: [],
    warnings: [],
    counts: {
      courses: 0,
      offerings: 0
    }
  };

  for (const requiredPath of [
    'public/academic/v1',
    'public/academic/v1/courses',
    'public/academic/v1/offerings'
  ]) {
    if (!existsSync(path.join(root, requiredPath))) {
      result.errors.push(`${requiredPath}: missing required directory`);
    }
  }

  const coursesPath = 'public/academic/v1/courses.json';
  const offeringsPath = 'public/academic/v1/offerings.json';
  const coursesValue = existsSync(path.join(root, coursesPath))
    ? await readJson(root, coursesPath)
    : [];
  const offeringsValue = existsSync(path.join(root, offeringsPath))
    ? await readJson(root, offeringsPath)
    : [];

  if (!Array.isArray(coursesValue)) {
    result.errors.push(`${coursesPath}: expected a JSON array`);
    return result;
  }

  if (!Array.isArray(offeringsValue)) {
    result.errors.push(`${offeringsPath}: expected a JSON array`);
    return result;
  }

  const courses = new Map<string, JsonRecord>();
  const courseCodes = new Map<string, string>();
  for (const [index, value] of coursesValue.entries()) {
    const course = validateRecord(
      result,
      `${coursesPath}[${index}]`,
      value,
      courseSchema
    );
    if (!course) continue;

    if (courses.has(course.id)) {
      result.errors.push(`${coursesPath}[${index}]: duplicate course id`);
    }

    for (const code of course.codes) {
      const owner = courseCodes.get(code);
      if (owner && owner !== course.id) {
        result.errors.push(
          `${coursesPath}[${index}].codes: duplicate course code ${code}`
        );
      }
      courseCodes.set(code, course.id);
    }

    courses.set(course.id, course);
    result.counts.courses += 1;
  }

  const offerings = new Map<string, JsonRecord>();
  const offeringKeys = new Set<string>();
  for (const [index, value] of offeringsValue.entries()) {
    const offering = validateRecord(
      result,
      `${offeringsPath}[${index}]`,
      value,
      offeringSchema
    );
    if (!offering) continue;

    if (offerings.has(offering.id)) {
      result.errors.push(`${offeringsPath}[${index}]: duplicate offering id`);
    }

    if (!courses.has(offering.courseId)) {
      result.errors.push(
        `${offeringsPath}[${index}].courseId: missing referenced course`
      );
    }

    const offeringKey = `${offering.courseId}:${offering.academicYear}:${offering.semester}`;
    if (offeringKeys.has(offeringKey)) {
      result.errors.push(
        `${offeringsPath}[${index}]: duplicate course/year/semester offering`
      );
    }
    offeringKeys.add(offeringKey);

    offerings.set(offering.id, offering);
    result.counts.offerings += 1;
  }

  const courseFiles = await listJsonFiles(root, 'public/academic/v1/courses');
  const seenCourseFiles = new Set<string>();
  for (const coursePath of courseFiles) {
    const value = await readJson(root, coursePath);
    const course = validateRecord(result, coursePath, value, courseSchema);
    if (!course) continue;

    seenCourseFiles.add(course.id);
    const expectedPath = `public/academic/v1/courses/${course.id}.json`;
    if (coursePath !== expectedPath) {
      result.errors.push(
        `${coursePath}: filename does not match course id "${course.id}"`
      );
    }

    const aggregateCourse = courses.get(course.id);
    if (!aggregateCourse) {
      result.errors.push(`${coursePath}: missing from ${coursesPath}`);
    } else if (stableJson(course) !== stableJson(aggregateCourse)) {
      result.errors.push(`${coursePath}: differs from ${coursesPath}`);
    }
  }

  for (const courseId of courses.keys()) {
    if (!seenCourseFiles.has(courseId)) {
      result.errors.push(
        `public/academic/v1/courses/${courseId}.json: missing course file`
      );
    }
  }

  const offeringFiles = await listJsonFiles(
    root,
    'public/academic/v1/offerings'
  );
  const seenOfferingFiles = new Set<string>();
  for (const offeringPath of offeringFiles) {
    const value = await readJson(root, offeringPath);
    const offering = validateRecord(
      result,
      offeringPath,
      value,
      offeringSchema
    );
    if (!offering) continue;

    seenOfferingFiles.add(offering.id);
    const expectedPath = `public/academic/v1/offerings/${offering.id}.json`;
    if (offeringPath !== expectedPath) {
      result.errors.push(
        `${offeringPath}: filename does not match offering id "${offering.id}"`
      );
    }

    const aggregateOffering = offerings.get(offering.id);
    if (!aggregateOffering) {
      result.errors.push(`${offeringPath}: missing from ${offeringsPath}`);
    } else if (stableJson(offering) !== stableJson(aggregateOffering)) {
      result.errors.push(`${offeringPath}: differs from ${offeringsPath}`);
    }
  }

  for (const offeringId of offerings.keys()) {
    if (!seenOfferingFiles.has(offeringId)) {
      result.errors.push(
        `public/academic/v1/offerings/${offeringId}.json: missing offering file`
      );
    }
  }

  return result;
}

if (import.meta.main) {
  const result = await validateAcademicData();

  for (const warning of result.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (result.errors.length) {
    console.error('Academic data validation failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Academic data validation passed.');
  console.log(`courses=${result.counts.courses}`);
  console.log(`offerings=${result.counts.offerings}`);
}
