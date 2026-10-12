; ModuleID = 'bubble.c'
source_filename = "bubble.c"
target datalayout = "e-m:e-p:32:32-i64:64-n32-S128"
target triple = "riscv32-unknown-unknown"

@v = dso_local global [6 x i32] [i32 5, i32 2, i32 6, i32 1, i32 4, i32 3], align 4

; Function Attrs: noinline nounwind optnone
define dso_local void @troca(ptr noundef %0, ptr noundef %1) #0 {
  %3 = alloca ptr, align 4
  %4 = alloca ptr, align 4
  %5 = alloca i32, align 4
  store ptr %0, ptr %3, align 4
  store ptr %1, ptr %4, align 4
  %6 = load ptr, ptr %3, align 4
  %7 = load i32, ptr %6, align 4
  store i32 %7, ptr %5, align 4
  %8 = load ptr, ptr %4, align 4
  %9 = load i32, ptr %8, align 4
  %10 = load ptr, ptr %3, align 4
  store i32 %9, ptr %10, align 4
  %11 = load i32, ptr %5, align 4
  %12 = load ptr, ptr %4, align 4
  store i32 %11, ptr %12, align 4
  ret void
}

; Function Attrs: noinline nounwind optnone
define dso_local void @ordena(ptr noundef %0, i32 noundef %1) #0 {
  %3 = alloca ptr, align 4
  %4 = alloca i32, align 4
  %5 = alloca i32, align 4
  %6 = alloca i32, align 4
  store ptr %0, ptr %3, align 4
  store i32 %1, ptr %4, align 4
  store i32 0, ptr %5, align 4
  br label %7

7:                                                ; preds = %44, %2
  %8 = load i32, ptr %5, align 4
  %9 = load i32, ptr %4, align 4
  %10 = sub nsw i32 %9, 1
  %11 = icmp slt i32 %8, %10
  br i1 %11, label %12, label %47

12:                                               ; preds = %7
  store i32 0, ptr %6, align 4
  br label %13

13:                                               ; preds = %40, %12
  %14 = load i32, ptr %6, align 4
  %15 = load i32, ptr %4, align 4
  %16 = sub nsw i32 %15, 1
  %17 = load i32, ptr %5, align 4
  %18 = sub nsw i32 %16, %17
  %19 = icmp slt i32 %14, %18
  br i1 %19, label %20, label %43

20:                                               ; preds = %13
  %21 = load ptr, ptr %3, align 4
  %22 = load i32, ptr %6, align 4
  %23 = getelementptr inbounds i32, ptr %21, i32 %22
  %24 = load i32, ptr %23, align 4
  %25 = load ptr, ptr %3, align 4
  %26 = load i32, ptr %6, align 4
  %27 = add nsw i32 %26, 1
  %28 = getelementptr inbounds i32, ptr %25, i32 %27
  %29 = load i32, ptr %28, align 4
  %30 = icmp sgt i32 %24, %29
  br i1 %30, label %31, label %39

31:                                               ; preds = %20
  %32 = load ptr, ptr %3, align 4
  %33 = load i32, ptr %6, align 4
  %34 = getelementptr inbounds i32, ptr %32, i32 %33
  %35 = load ptr, ptr %3, align 4
  %36 = load i32, ptr %6, align 4
  %37 = add nsw i32 %36, 1
  %38 = getelementptr inbounds i32, ptr %35, i32 %37
  call void @troca(ptr noundef %34, ptr noundef %38)
  br label %39

39:                                               ; preds = %31, %20
  br label %40

40:                                               ; preds = %39
  %41 = load i32, ptr %6, align 4
  %42 = add nsw i32 %41, 1
  store i32 %42, ptr %6, align 4
  br label %13, !llvm.loop !5

43:                                               ; preds = %13
  br label %44

44:                                               ; preds = %43
  %45 = load i32, ptr %5, align 4
  %46 = add nsw i32 %45, 1
  store i32 %46, ptr %5, align 4
  br label %7, !llvm.loop !7

47:                                               ; preds = %7
  ret void
}

; Function Attrs: noinline nounwind optnone
define dso_local i32 @main() #0 {
  %1 = alloca i32, align 4
  %2 = alloca i32, align 4
  %3 = alloca i32, align 4
  store i32 0, ptr %1, align 4
  call void @ordena(ptr noundef @v, i32 noundef 6)
  store i32 0, ptr %2, align 4
  store i32 0, ptr %3, align 4
  br label %4

4:                                                ; preds = %14, %0
  %5 = load i32, ptr %3, align 4
  %6 = icmp slt i32 %5, 6
  br i1 %6, label %7, label %17

7:                                                ; preds = %4
  %8 = load i32, ptr %2, align 4
  %9 = mul nsw i32 %8, 10
  %10 = load i32, ptr %3, align 4
  %11 = getelementptr inbounds [6 x i32], ptr @v, i32 0, i32 %10
  %12 = load i32, ptr %11, align 4
  %13 = add nsw i32 %9, %12
  store i32 %13, ptr %2, align 4
  br label %14

14:                                               ; preds = %7
  %15 = load i32, ptr %3, align 4
  %16 = add nsw i32 %15, 1
  store i32 %16, ptr %3, align 4
  br label %4, !llvm.loop !8

17:                                               ; preds = %4
  %18 = load i32, ptr %2, align 4
  ret i32 %18
}

attributes #0 = { noinline nounwind optnone "frame-pointer"="all" "no-trapping-math"="true" "stack-protector-buffer-size"="8" "target-cpu"="generic-rv32" "target-features"="+32bit,+f,+m,+relax,+zicsr,-a,-c,-d,-e,-experimental-zacas,-experimental-zcmop,-experimental-zfbfmin,-experimental-zicfilp,-experimental-zicfiss,-experimental-zimop,-experimental-ztso,-experimental-zvfbfmin,-experimental-zvfbfwma,-h,-smaia,-smepmp,-ssaia,-svinval,-svnapot,-svpbmt,-v,-xcvalu,-xcvbi,-xcvbitmanip,-xcvelw,-xcvmac,-xcvmem,-xcvsimd,-xsfvcp,-xsfvfnrclipxfqf,-xsfvfwmaccqqq,-xsfvqmaccdod,-xsfvqmaccqoq,-xtheadba,-xtheadbb,-xtheadbs,-xtheadcmo,-xtheadcondmov,-xtheadfmemidx,-xtheadmac,-xtheadmemidx,-xtheadmempair,-xtheadsync,-xtheadvdot,-xventanacondops,-za128rs,-za64rs,-zawrs,-zba,-zbb,-zbc,-zbkb,-zbkc,-zbkx,-zbs,-zca,-zcb,-zcd,-zce,-zcf,-zcmp,-zcmt,-zdinx,-zfa,-zfh,-zfhmin,-zfinx,-zhinx,-zhinxmin,-zic64b,-zicbom,-zicbop,-zicboz,-ziccamoa,-ziccif,-zicclsm,-ziccrse,-zicntr,-zicond,-zifencei,-zihintntl,-zihintpause,-zihpm,-zk,-zkn,-zknd,-zkne,-zknh,-zkr,-zks,-zksed,-zksh,-zkt,-zmmul,-zvbb,-zvbc,-zve32f,-zve32x,-zve64d,-zve64f,-zve64x,-zvfh,-zvfhmin,-zvkb,-zvkg,-zvkn,-zvknc,-zvkned,-zvkng,-zvknha,-zvknhb,-zvks,-zvksc,-zvksed,-zvksg,-zvksh,-zvkt,-zvl1024b,-zvl128b,-zvl16384b,-zvl2048b,-zvl256b,-zvl32768b,-zvl32b,-zvl4096b,-zvl512b,-zvl64b,-zvl65536b,-zvl8192b" }

!llvm.module.flags = !{!0, !1, !2, !3}
!llvm.ident = !{!4}

!0 = !{i32 1, !"wchar_size", i32 4}
!1 = !{i32 1, !"target-abi", !"ilp32f"}
!2 = !{i32 7, !"frame-pointer", i32 2}
!3 = !{i32 8, !"SmallDataLimit", i32 8}
!4 = !{!"Ubuntu clang version 18.1.3 (1ubuntu1)"}
!5 = distinct !{!5, !6}
!6 = !{!"llvm.loop.mustprogress"}
!7 = distinct !{!7, !6}
!8 = distinct !{!8, !6}
